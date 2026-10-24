function fixture(){if(!globalThis.metroCommerceE2e)throw Error('Isolated commerce fixture is not configured.');return globalThis.metroCommerceE2e;}
export async function getWebsiteSession(){return fixture().session;}
export async function foundationDatabase(){return fixture().app;}
export async function getWebsiteRepositories(){return fixture().repositories();}
export async function getAdminRepository(){return fixture().adminRepository();}
export async function getPricingRepository(){return fixture().pricingRepository();}
export async function getPublicPricing(){return fixture().readPricing();}
export function readServerEnvironment(){return {enabled:true,origin:'https://metro-e2e.invalid',secret:fixture().secret};}
export function isLoopbackHost(hostname){return ['localhost','127.0.0.1','[::1]'].includes(hostname);}
export function revalidatePath(path){fixture().invalidated.add(path);}
export async function headers(){return fixture().headers;}
export async function adminPage(work){return work();}
export async function requireWebsiteSession(){if(!fixture().session)throw Error('ISOLATED_UNAUTHENTICATED');return fixture().session;}
