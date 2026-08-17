#!/bin/sh
set -eu

export HD_ENV_SCHEMA_VERSION="${HD_ENV_SCHEMA_VERSION:-1}"
export HD_ENVIRONMENT_CLASS="${HD_ENVIRONMENT_CLASS:-milestone}"
export HD_RUNTIME_MODE="${HD_RUNTIME_MODE:-frozen_certification}"
export HD_PUBLIC_SURFACE="${HD_PUBLIC_SURFACE:-gold_master}"
export HD_SERVER_HOST="${HD_SERVER_HOST:-0.0.0.0}"
export HD_SERVER_PORT="${PORT:-${HD_SERVER_PORT:-8080}}"
export HD_CLIENT_BUNDLE_DIR="${HD_CLIENT_BUNDLE_DIR:-/app/dist/client}"

exec node dist/server/index.js
