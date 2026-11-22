#!/bin/sh
set -eu

export IPFS_PATH=/data/ipfs

if [ ! -f "$IPFS_PATH/config" ]; then
    ipfs init --profile=server --empty-repo
fi

cp /run/bia/swarm.key "$IPFS_PATH/swarm.key"
chmod 600 "$IPFS_PATH/swarm.key"
ipfs config --json AutoConf.Enabled false
ipfs config --json AutoTLS.Enabled false
ipfs config --json Bootstrap '[]'
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Datastore.StorageMax "${KUBO_STORAGE_MAX:-50GB}"

exec ipfs daemon --migrate=true --agent-version-suffix=bia
