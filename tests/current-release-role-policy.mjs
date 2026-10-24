import { identifier } from '../scripts/foundation/roles.mjs';
import { pricingGrantsSql } from '../scripts/foundation/pricing-grants.mjs';
// Disposable verification only. Keep the original foundation approval scope
// unchanged; apply current additive release policy explicitly in this runner.
export async function currentReleaseRuntimePolicy(client, roles) {
  await client.query(pricingGrantsSql(roles));
  const runtime = identifier(roles.runtime), migration = identifier(roles.migration);
  await client.query(`ALTER TABLE metro_pricing_release OWNER TO ${migration};
    ALTER TABLE metro_website_notification OWNER TO ${migration};
    REVOKE ALL ON metro_website_notification FROM PUBLIC,${runtime};
    GRANT SELECT,INSERT ON metro_website_notification TO ${runtime};
    GRANT UPDATE("readAt") ON metro_website_notification TO ${runtime};`);
}
