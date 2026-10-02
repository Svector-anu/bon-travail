export const THEME_KEY = 'proofwork.theme'

/** Runs before paint so the page never flashes the wrong theme. */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('${THEME_KEY}');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`
