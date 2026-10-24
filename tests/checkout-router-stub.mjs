export function useRouter(){return{replace(){},refresh(){},push(){}}}
export function usePathname(){return '/plans';}
export function notFound(){throw new Error('ISOLATED_NOT_FOUND')}
export function redirect(path){throw new Error('ISOLATED_REDIRECT:'+path)}
