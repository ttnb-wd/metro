import { identifier, productionRoles } from './roles.mjs';

// Run only in an approved migration window after the additive pricing migration.
// Runtime can append versions, never rewrite history. OWNER is enforced in the DAL.
export function pricingGrantsSql(roles = productionRoles) {
  return `REVOKE ALL ON metro_pricing_release FROM PUBLIC,${identifier(roles.runtime)},${identifier(roles.assignment)};
    GRANT SELECT,INSERT ON metro_pricing_release TO ${identifier(roles.runtime)};`;
}
