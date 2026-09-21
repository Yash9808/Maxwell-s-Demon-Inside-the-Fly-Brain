"use strict";
/**
 * deployment/lib/mode_protocol.js — frozen protocol-contract verification.
 *
 * Verifies the LIVE embodiment/state_contract.js still matches the Phase 01
 * frozen record (baselines/protocol/state_contract_v1.json):
 *   - source bytes unchanged (sha256 == frozen.source_sha256)
 *   - version / action / observation / neural dimensions (live require)
 *   - every frozen error code and message type still present in the source
 *   - negative R-guards still present in tests/closed_loop.test.js
 * Fails closed on any drift. Does NOT modify the contract file.
 */
const fs = require("fs");
const path = require("path");
const util = require("./util");

async function modeProtocol(jsonOut) {
  const problems = [];
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
    if (!ok) problems.push(name);
  };

  const frozenPath = path.join(util.ROOT, "baselines", "protocol", "state_contract_v1.json");
  const livePath = path.join(util.ROOT, "embodiment", "state_contract.js");
  check("frozen_record_present", fs.existsSync(frozenPath));
  check("live_contract_present", fs.existsSync(livePath));
  if (!fs.existsSync(frozenPath) || !fs.existsSync(livePath)) {
    jsonOut.checks = checks;
    return problems;
  }

  const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
  const liveSrc = fs.readFileSync(livePath, "utf8");
  const liveSha = util.sha256File(livePath);

  // 1. byte identity with the frozen record (strongest freeze check)
  check("source_bytes_unchanged_since_phase01", liveSha === frozen.source_sha256,
    `live=${liveSha} frozen=${frozen.source_sha256}`);

  // 2. live dimensions (via require; constants only — no behavior executed)
  const live = require(livePath);
  check("protocol_version", live.CONTRACT_VERSION === frozen.contract_version,
    `live=${live.CONTRACT_VERSION} frozen=${frozen.contract_version}`);
  check("action_dim_59", live.ACTION_DIM === frozen.action_dim && live.ACTION_DIM === 59);
  check("observation_dim", live.OBS_DIM === frozen.observation_dim);
  check("neural_max_dim", live.NEURAL_MAX_DIM === frozen.neural_max_dim);
  check("canonical_neural_dim_200", frozen.canonical_neural_dim === 200);

  // 3. frozen error codes and message types still present as literals
  for (const c of frozen.error_codes || []) {
    check(`error_code_present_${c}`, liveSrc.includes(`"${c}"`) || liveSrc.includes(`'${c}'`));
  }
  for (const t of frozen.message_types || []) {
    check(`message_type_present_${t}`, liveSrc.includes(`"${t}"`) || liveSrc.includes(`'${t}'`));
  }

  // 4. stale/malformed semantics in the frozen record must not soften
  check("stale_behavior_rejects", /reject/i.test(frozen.stale_behavior || ""));
  check("malformed_behavior_failclosed", /fail-closed/i.test(frozen.malformed_behavior || ""));

  // 5. negative R-guards still present in the closed-loop suite source
  const clSrc = fs.readFileSync(path.join(util.ROOT, "tests", "closed_loop.test.js"), "utf8");
  for (const guard of ["missing_neural", "stale_episode", "stale_time", "neural_dim_changed", "contract_violation"]) {
    check(`negative_guard_${guard}`, clSrc.includes(guard));
  }

  checks.push({ name: "live_source_sha256", ok: true, detail: liveSha });
  jsonOut.checks = checks;
  return problems;
}

module.exports = modeProtocol;
