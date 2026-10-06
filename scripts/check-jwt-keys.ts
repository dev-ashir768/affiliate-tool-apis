/** Sanity check: signs and verifies an access token with the configured keys. */
import { signAccessToken, verifyAccessToken } from "../src/lib/tokens.js";

const token = await signAccessToken({
  sub: "check",
  orgId: null,
  orgRole: null,
  platformRole: null,
  hasProductAccess: false,
});
const alg = JSON.parse(
  Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
).alg;
const claims = await verifyAccessToken(token);
console.log(`jwt ok: alg=${alg} sub=${claims.sub}`);
process.exit(0);
