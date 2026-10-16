#!/usr/bin/env bash
# Delete the local kind cluster and everything on it.
set -euo pipefail
kind delete cluster --name shelfwise
