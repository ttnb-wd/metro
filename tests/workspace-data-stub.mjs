// Isolated component fixtures. Production routes still use real repositories.
export async function getWebsiteRepositories() { return { listServices: async()=>[], listOrders: async()=>[], listIssues: async()=>[] }; }
export async function getPublicPricing() { return {status:'UNPUBLISHED'}; }
export async function requestTimestamp() { return Date.parse('2026-10-21T00:00:00Z'); }

export async function getPricingRepository(){throw new Error("No repository writes in component tests.");}
export async function foundationDatabase(){throw new Error("No database in component tests.");}
