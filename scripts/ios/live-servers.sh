#!/bin/sh
# Servers for the iPhone app's live tests (issue #576, task 4.7), started on the
# macOS runner itself: it has no Docker, and the simulator shares the Mac's
# network, so 127.0.0.1 from the app is this machine.
#
#   scripts/ios/live-servers.sh [dir]     (default: $RUNNER_TEMP/live)
#
# - a CA of our own and a certificate for 127.0.0.1 signed by it;
# - PostgreSQL 16 with TLS on 55432, role squaero / live, database live;
# - MongoDB with TLS required on 57017, no auth;
# - sshd on 2222 taking one ed25519 key, for the tunnel.
# What the tests need is appended to $GITHUB_ENV as TEST_RUNNER_* variables,
# which xcodebuild hands to the test process without the prefix. Files cross
# as base64: the simulator's process is not meant to read the runner's paths.
# Informix is not here: it only comes as a Docker image.

set -eu

d=${1:-"$RUNNER_TEMP/live"}
mkdir -p "$d"
cd "$d"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=squaero-live-ca \
  -keyout ca.key -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj /CN=127.0.0.1 \
  -keyout server.key -out server.csr 2>/dev/null
printf 'subjectAltName=IP:127.0.0.1,DNS:localhost\n' > san.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
  -extfile san.ext -out server.pem 2>/dev/null
chmod 600 server.key
cat server.key server.pem > server-bundle.pem

brew install postgresql@16 >/dev/null
pg=$(brew --prefix postgresql@16)/bin
"$pg/initdb" -D pgdata -U postgres --auth=trust >/dev/null
cat >> pgdata/postgresql.conf <<EOF
ssl = on
ssl_cert_file = '$d/server.pem'
ssl_key_file = '$d/server.key'
listen_addresses = '127.0.0.1'
port = 55432
unix_socket_directories = '$d'
EOF
printf 'local all all trust\nhost all all 127.0.0.1/32 scram-sha-256\n' > pgdata/pg_hba.conf
"$pg/pg_ctl" -D pgdata -l pg.log -w start
"$pg/psql" -h "$d" -p 55432 -U postgres -q \
  -c "CREATE ROLE squaero LOGIN PASSWORD 'live'" -c "CREATE DATABASE live OWNER squaero"

# MongoDB's official build: Homebrew refuses formulas from its tap (untrusted).
curl -fsSL https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.0.4.tgz | tar xz
mkdir -p mongodata
mongodb-macos-aarch64-8.0.4/bin/mongod --dbpath mongodata --bind_ip 127.0.0.1 --port 57017 \
  --tlsMode requireTLS --tlsCertificateKeyFile server-bundle.pem \
  --tlsCAFile ca.pem --tlsAllowConnectionsWithoutCertificates \
  --fork --logpath mongo.log || { tail -n 30 mongo.log; exit 1; }

ssh-keygen -q -t ed25519 -N '' -f client_key
ssh-keygen -q -t ed25519 -N '' -f host_key
mkdir -p ~/.ssh
cat client_key.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
cat > sshd_config <<EOF
Port 2222
ListenAddress 127.0.0.1
HostKey $d/host_key
PidFile $d/sshd.pid
AuthorizedKeysFile $HOME/.ssh/authorized_keys
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowTcpForwarding yes
StrictModes no
UsePAM no
EOF
sudo /usr/sbin/sshd -f "$d/sshd_config" -E "$d/sshd.log"

b64() { base64 < "$1" | tr -d '\n'; }
{
  echo "TEST_RUNNER_QUAERO_LIVE=1"
  echo "TEST_RUNNER_QUAERO_LIVE_CA=$(b64 ca.pem)"
  echo "TEST_RUNNER_QUAERO_LIVE_SSH_KEY=$(b64 client_key)"
  echo "TEST_RUNNER_QUAERO_LIVE_SSH_USER=$(whoami)"
} >> "${GITHUB_ENV:-/dev/stdout}"
