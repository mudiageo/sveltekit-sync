   import { initDB } from '$lib/db';
  import { browser } from '$app/environment'
const load = async  () => {
  if(browser) await initDB();
}