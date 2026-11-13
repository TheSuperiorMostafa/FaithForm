/** An interrupted action may already have committed. Keep the current form
 * and ask the person to check its status instead of claiming it succeeded. */
export async function websiteActionRequest<T extends { ok: boolean }>(request: () => Promise<T>): Promise<T | {ok:false;error:string}> {
  try { return await request(); }
  catch { return {ok:false,error:"We couldn't confirm that change. Refresh this page to check its status, then try again."}; }
}
