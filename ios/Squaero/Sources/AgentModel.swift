// The agent's side that needs the model (issue #580, tasks 8.4-8.7): Apple's
// on-device model through Foundation Models, with the read-only tools of
// Agent.swift. Everything it writes goes through AgentCheck, and nothing it
// writes runs by itself: SQL waits in the editor, a change in the preview.

#if canImport(FoundationModels)
import Foundation
import FoundationModels
import SquaeroLogic

@available(iOS 26.0, *)
struct SearchSchemaTool: Tool {
    let name = "buscarEsquema"
    let description = "Busca tablas cuyo nombre contiene un texto y devuelve sus columnas y tipos."
    let tools: AgentTools

    @Generable
    struct Arguments {
        @Guide(description: "Parte del nombre de la tabla, por ejemplo audiencia")
        var texto: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await tools.searchSchema(arguments.texto)
    }
}

@available(iOS 26.0, *)
struct DescribeTableTool: Tool {
    let name = "describirTabla"
    let description = "Devuelve las columnas, tipos y clave primaria de una tabla."
    let tools: AgentTools

    @Generable
    struct Arguments {
        @Guide(description: "Nombre exacto de la tabla")
        var nombre: String
    }

    func call(arguments: Arguments) async throws -> String {
        try await tools.describeTable(arguments.nombre)
    }
}

@available(iOS 26.0, *)
struct RunSelectTool: Tool {
    let name = "ejecutarSelect"
    let description = "Ejecuta una sola sentencia SELECT y devuelve hasta 50 filas. Rechaza todo lo que cambie datos."
    let tools: AgentTools

    @Generable
    struct Arguments {
        @Guide(description: "Una sentencia SELECT")
        var sql: String
    }

    func call(arguments: Arguments) async throws -> String {
        do {
            return try await tools.runSelect(arguments.sql)
        } catch let refusal as AgentTools.Refusal {
            return refusal.localizedDescription // told to the model, which then says it cannot
        }
    }
}

@available(iOS 26.0, *)
@Generable
struct ErrorHelp {
    @Guide(description: "Qué significa el error, en una o dos frases sencillas")
    var explanation: String
    @Guide(description: "La sentencia corregida con las columnas reales, o vacío si no hay un arreglo seguro")
    var fixedSQL: String
}

@available(iOS 26.0, *)
@Generable
struct AskedSQL {
    @Guide(description: "Una sola sentencia SELECT en el dialecto del motor, solo con tablas y columnas consultadas")
    var sql: String
    @Guide(description: "Qué devuelve la consulta, en una frase")
    var summary: String
}

@available(iOS 26.0, *)
@Generable
struct AskedChange {
    @Guide(description: "Las columnas a cambiar y su nuevo valor")
    var changes: [AskedValue]
}

@available(iOS 26.0, *)
@Generable
struct AskedValue {
    @Guide(description: "Nombre exacto de una columna de la fila")
    var column: String
    @Guide(description: "El nuevo valor, sin comillas; NULL para vaciarla")
    var value: String
}

/// The four requests, each in its own short session: the model's context is
/// small, so nothing carries over between them.
@available(iOS 26.0, *)
@MainActor
enum Agent {
    private static func base(_ tools: AgentTools) -> String {
        "Eres el asistente de Squaero, un cliente de bases de datos. Motor: \(tools.engine). "
            + "Respondes en el idioma del usuario. Solo lees datos: nunca propones ejecutar nada que cambie datos."
    }

    /// The columns of the tables sql names, for the model to check names against.
    private static func context(_ sql: String, _ tools: AgentTools) async -> String {
        let names = (try? Logic.shared.tablesInStatement(sql)) ?? []
        var lines: [String] = []
        for name in names.prefix(4) {
            if let d = try? await tools.describeTable(name) { lines.append(d) }
        }
        return lines.isEmpty ? "" : "Tablas:\n" + lines.joined(separator: "\n")
    }

    /// Task 8.4: what an error means, and a fix with the real columns.
    static func explainError(sql: String, error: String, tools: AgentTools) async throws
        -> (explanation: String, fix: String?) {
        let session = LanguageModelSession(instructions: base(tools))
        let prompt = """
            Esta sentencia falló.
            SQL: \(sql)
            Error: \(error)
            \(await context(sql, tools))
            Explica el error y, si hay un arreglo seguro, da la sentencia corregida usando solo las columnas listadas.
            """
        let help = try await session.respond(to: prompt, generating: ErrorHelp.self).content
        return (help.explanation, AgentCheck.statement(help.fixedSQL))
    }

    /// Task 8.5: what a query or snippet does, before it runs.
    static func explain(sql: String, tools: AgentTools) async throws -> String {
        let session = LanguageModelSession(instructions: base(tools))
        let prompt = """
            Explica en pocas frases qué hace esta sentencia y qué devolvería o cambiaría. No la ejecutes.
            SQL: \(sql)
            \(await context(sql, tools))
            """
        return try await session.respond(to: prompt).content
    }

    /// Task 8.6: a SELECT for a question, from the schema it looks up. Nil
    /// when what it wrote is not provably read-only.
    static func ask(question: String, tools: AgentTools) async throws -> (sql: String, summary: String)? {
        let session = LanguageModelSession(
            tools: [SearchSchemaTool(tools: tools), DescribeTableTool(tools: tools), RunSelectTool(tools: tools)],
            instructions: base(tools) + " Para responder, busca las tablas con buscarEsquema y describirTabla; "
                + "usa solo tablas y columnas que hayas consultado. Hoy es "
                + Date().formatted(.iso8601.year().month().day()) + ".")
        let answer = try await session.respond(to: question, generating: AskedSQL.self).content
        guard let sql = AgentCheck.select(answer.sql) else { return nil }
        return (sql, answer.summary)
    }

    /// Task 8.7: the new values a request asks of one row. They fill in the
    /// edit; the preview and Face ID stay the user's.
    static func change(request: String, table: String, columns: [String], values: [String?], pk: [String],
                       engine: String) async throws -> [(column: String, value: String?)] {
        let session = LanguageModelSession(instructions:
            "Conviertes una petición en cambios de columnas de una fila. Motor: \(engine). "
                + "Usa solo columnas de la lista y nunca las de la clave primaria.")
        let row = zip(columns, values).map { "\($0) = \($1 ?? "NULL")" }.joined(separator: "\n")
        let prompt = """
            Tabla: \(table)
            Clave primaria: \(pk.joined(separator: ", "))
            Fila:
            \(row)
            Petición: \(request)
            """
        let answer = try await session.respond(to: prompt, generating: AskedChange.self).content
        return AgentCheck.changes(answer.changes.map { ($0.column, $0.value) }, columns: columns, pk: pk)
    }
}
#endif
