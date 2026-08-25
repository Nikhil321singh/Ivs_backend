#!/usr/bin/env bash
# DigiLocker (SprintVerify) API — curl reference.
#
#   source scripts/digilocker-curl.sh     # loads env + the token minter
#
# Then call: dl_initiate / dl_access_token / dl_issued_files / dl_download_xml
#
# ⚠  PRODUCTION ONLY. DigiLocker has no UAT host. A 200 or 422 is BILLED;
#    a 201 is not. Every call below is against live infrastructure.
#
# ⚠  Do NOT send an Authorisedkey header. Production rejects a wrong value with
#    "Invalid user.<your ip>" — which looks like an IP problem and is not one.

set -u
ENV_FILE="${ENV_FILE:-$(dirname "${BASH_SOURCE[0]}")/../.env}"

# Read creds straight from .env so nothing is pasted into a shell history.
PARTNER_ID=$(grep -E '^PAYSPRINT_PARTNER_ID=' "$ENV_FILE" | cut -d= -f2-)
JWT_KEY=$(grep -E '^PAYSPRINT_AUTHORISED_KEY=' "$ENV_FILE" | cut -d= -f2-)
BASE_URL=$(grep -E '^PAYSPRINT_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)
# DIGILOCKER_REDIRECT_URL is usually absent from .env; config/env.js derives it
# from API_BASE_URL, so mirror that here or the provider answers 201
# "Corporate redirect url is required."
REDIRECT_URL=$(grep -E '^DIGILOCKER_REDIRECT_URL=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "${REDIRECT_URL}" ]; then
  REDIRECT_URL="$(grep -E '^API_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)/api/v1/user/aadhaar/digilocker/callback"
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Mints the §2.1 payload: {timestamp, partnerId, reqid}. HS256, no other claims.
# timestamp is backdated 120s — Paysprint's clock lags and rejects "future" tokens.
dl_token() {
  local ts hdr pl body sig
  ts=$(( $(date +%s) - 120 ))
  hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  pl=$(printf '{"timestamp":%s,"partnerId":"%s","reqid":"%s"}' \
        "$ts" "$PARTNER_ID" "$(date +%s%N | cut -c1-14)" | b64url)
  body="${hdr}.${pl}"
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$JWT_KEY" -binary | b64url)
  printf '%s.%s' "$body" "$sig"
}

# One request. multipart/form-data per §2.4; -F makes curl set the boundary.
_dl_call() {
  local path="$1"; shift
  curl -sS -w '\n[http %{http_code}  %{time_total}s]\n' \
    -X POST "${BASE_URL}${path}" \
    -H "Token: $(dl_token)" \
    -H "User-Agent: ${PARTNER_ID}" \
    "$@"
}

# 1. Open a session. Returns the DigiLocker consent URL. BILLABLE on 200.
#    usage: dl_initiate [refid]
dl_initiate() {
  local refid="${1:-CURL$(date +%s)}"
  echo "refid=${refid}" >&2
  _dl_call /digilocker/initiate_session -F "refid=${refid}" -F "redirect_url=${REDIRECT_URL}"
}

# 2-4. These only work AFTER a human finished the consent URL from step 1 in a
#      browser, using that SAME refid. On a fresh refid they will fail.
dl_access_token() { _dl_call /digilocker/access_token -F "refid=${1:?refid required}"; }
dl_issued_files() { _dl_call /digilocker/issued_files -F "refid=${1:?refid required}"; }
dl_download_xml() {
  _dl_call /digilocker/download_xml -F "refid=${1:?refid required}" -F "uri=${2:?uri required}"
}

echo "loaded: dl_initiate  dl_access_token  dl_issued_files  dl_download_xml"
echo "base:   ${BASE_URL}"
echo "partner:${PARTNER_ID}   Authorisedkey: not sent (correct for prod)"
echo "redirect:${REDIRECT_URL}"
