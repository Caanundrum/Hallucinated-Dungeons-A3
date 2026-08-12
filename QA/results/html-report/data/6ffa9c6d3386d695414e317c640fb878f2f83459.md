# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase0-player.qa.spec.ts >> Phase 0 independent QA — announcement and focus behaviour >> QA-S17 the polite live region survives a state change so it can announce
- Location: scripts/phase0-player.qa.spec.ts:882:7

# Error details

```
Error: the live region should persist across renders

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - generic [ref=e4]:
    - banner [ref=e5]:
      - heading "Hallucinated Dungeons — Local Arena" [level=1] [ref=e6]
      - paragraph [ref=e7]: "Phase 0 greenfield foundation. This page proves the browser, local server, and Firebase emulators form one authenticated write and read path. It is not the game: characters, campaigns, the tactical map, and the AI Game Director are built in later phases."
    - generic [ref=e8]:
      - generic [ref=e9]: Candidate cand-0f810c6c26d8
      - generic [ref=e10]: Environment local
      - generic [ref=e11]: Mode frozen_certification
      - generic [ref=e12]: Emulator project hallucinated-dungeons-local
      - generic [ref=e13]: Blueprint ALPHA_3_V1
    - main [ref=e14]:
      - region [ref=e15]:
        - heading "Signed in for local testing" [level=2] [ref=e16]
        - paragraph [ref=e17]: Account dev-eb906168-10a9-4bb4-94f2-6aedecd85245 (Local Builder eb9061), session expires 8/12/2026, 8:21:12 PM.
        - button "Leave the Local Arena" [ref=e19] [cursor=pointer]
      - region [ref=e20]:
        - heading "Record a foundation check" [level=2] [ref=e21]
        - paragraph [ref=e22]: Recording a check sends your note to the local server, which authorizes it, writes it to the Firestore emulator, and returns the stored projection. The list below is always the server's answer, never a local copy of what you typed.
        - generic [ref=e23]:
          - generic [ref=e24]: Foundation check note
          - textbox "Foundation check note" [ref=e25]
          - paragraph [ref=e26]: Up to 120 characters. Submitting the same attempt twice returns the original record instead of writing a second one.
          - generic [ref=e27]:
            - button "Record foundation check" [ref=e28] [cursor=pointer]
            - button "Reload from server" [ref=e29] [cursor=pointer]
        - generic [ref=e30]: Recorded sequence 1.
      - region [ref=e31]:
        - heading "Stored for this account" [level=2] [ref=e32]
        - paragraph [ref=e33]: Projection version 1.
        - list [ref=e34]:
          - listitem [ref=e35]:
            - generic [ref=e36]: live region persistence probe
            - text: Sequence 1 · recorded 8/12/2026, 4:21:12 PM · id 993c1c0f-ccce-4cb7-a4de-72e8e78b6ac8
    - contentinfo [ref=e37]: Local Execution Environment only. Canonical state lives in the Firebase Emulator Suite and is disposable.
    - status [ref=e38]: Recorded sequence 1.
```

# Test source

```ts
  806  |     await page.waitForTimeout(500);
  807  | 
  808  |     const observed = {
  809  |       visibleMainText: await page.locator('main').innerText(),
  810  |       errorElements: await page.locator(el.error).count(),
  811  |       noticeElements: await page.locator(el.notice).count(),
  812  |       retryButtons: await page.locator(el.retry).count(),
  813  |       noteInputs: await page.locator(el.noteInput).count(),
  814  |       liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
  815  |       liveRegionVisibleToSightedUser: await page
  816  |         .locator(el.liveRegion)
  817  |         .evaluate((node) => {
  818  |           const style = window.getComputedStyle(node);
  819  |           const rect = node.getBoundingClientRect();
  820  |           return {
  821  |             className: node.className,
  822  |             width: rect.width,
  823  |             height: rect.height,
  824  |             clip: style.clip,
  825  |             position: style.position,
  826  |           };
  827  |         }),
  828  |     };
  829  |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
  830  | 
  831  |     await page.screenshot({ path: `${EVIDENCE}/s15-01-session-expiry-outcome.png`, fullPage: true });
  832  | 
  833  |     // Phase 0 promises failures are explained on the page with a real retry
  834  |     // path. Both halves are asserted here.
  835  |     expect(
  836  |       observed.visibleMainText,
  837  |       'the expiry reason should be readable on the page',
  838  |     ).toMatch(/session expired/i);
  839  |     expect(observed.errorElements, 'an error message element should be rendered').toBeGreaterThan(0);
  840  |   });
  841  | 
  842  |   test('QA-S16 the same invisibility affects a read that hits an expired session', async ({
  843  |     page,
  844  |   }) => {
  845  |     await enterArena(page);
  846  |     await recordNote(page, 'note before the read fails');
  847  |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  848  | 
  849  |     // End the session for real, server-side, while this tab still shows a
  850  |     // signed-in page. This is what a 4-hour expiry looks like to the tab.
  851  |     const ended = await page.evaluate(async () => {
  852  |       const response = await fetch('/api/session', {
  853  |         method: 'DELETE',
  854  |         credentials: 'same-origin',
  855  |         headers: { 'x-hd-candidate': 'cand-0f810c6c26d8' },
  856  |       });
  857  |       return response.status;
  858  |     });
  859  |     expect(ended).toBe(204);
  860  | 
  861  |     // The player, unaware, presses the page's own reload control.
  862  |     await page.click(el.refresh);
  863  |     await expect(page.locator(el.enter)).toBeVisible();
  864  |     await page.waitForTimeout(300);
  865  | 
  866  |     const observed = {
  867  |       visibleMainText: await page.locator('main').innerText(),
  868  |       errorElements: await page.locator(el.error).count(),
  869  |       liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
  870  |     };
  871  |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
  872  |     await page.screenshot({ path: `${EVIDENCE}/s16-01-expired-read-outcome.png`, fullPage: true });
  873  | 
  874  |     expect(
  875  |       observed.visibleMainText,
  876  |       'the page should say why it stopped showing the records',
  877  |     ).toMatch(/enter the local arena before|session expired/i);
  878  |   });
  879  | });
  880  | 
  881  | test.describe('Phase 0 independent QA — announcement and focus behaviour', () => {
  882  |   test('QA-S17 the polite live region survives a state change so it can announce', async ({
  883  |     page,
  884  |   }) => {
  885  |     await enterArena(page);
  886  | 
  887  |     // Tag the live region node, then cause a state change, then see whether the
  888  |     // tagged node is still the one on the page. A screen reader only announces
  889  |     // a polite region that already existed when its text changed.
  890  |     await page.evaluate(() => {
  891  |       const region = document.querySelector('[data-testid="live-region"]');
  892  |       (region as HTMLElement & { __qaTag?: string }).__qaTag = 'original';
  893  |     });
  894  | 
  895  |     await recordNote(page, 'live region persistence probe');
  896  |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  897  | 
  898  |     const survived = await page.evaluate(() => {
  899  |       const region = document.querySelector('[data-testid="live-region"]');
  900  |       return {
  901  |         sameNode: (region as HTMLElement & { __qaTag?: string })?.__qaTag === 'original',
  902  |         text: (region?.textContent ?? '').trim(),
  903  |       };
  904  |     });
  905  |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(survived) });
> 906  |     expect(survived.sameNode, 'the live region should persist across renders').toBe(true);
       |                                                                                ^ Error: the live region should persist across renders
  907  |   });
  908  | 
  909  |   test('QA-S18 focus is retained near the control the player just used', async ({ page }) => {
  910  |     await enterArena(page);
  911  |     await page.focus(el.noteInput);
  912  |     await page.keyboard.type('focus retention probe');
  913  |     await page.keyboard.press('Enter');
  914  |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  915  | 
  916  |     const afterSubmit = await page.evaluate(() => ({
  917  |       tag: document.activeElement?.tagName ?? null,
  918  |       testId: document.activeElement?.getAttribute('data-testid') ?? null,
  919  |     }));
  920  | 
  921  |     await page.click(el.refresh);
  922  |     await expect(page.locator(el.notice)).toContainText('Reloaded');
  923  |     const afterRefresh = await page.evaluate(() => ({
  924  |       tag: document.activeElement?.tagName ?? null,
  925  |       testId: document.activeElement?.getAttribute('data-testid') ?? null,
  926  |     }));
  927  | 
  928  |     test.info().annotations.push({
  929  |       type: 'observed',
  930  |       description: JSON.stringify({ afterSubmit, afterRefresh }),
  931  |     });
  932  | 
  933  |     expect(afterSubmit.tag, 'focus should not be dumped on <body> after submitting').not.toBe(
  934  |       'BODY',
  935  |     );
  936  |   });
  937  | });
  938  | 
  939  | test.describe('Phase 0 independent QA — completeness of what is shown', () => {
  940  |   test('QA-S19 a long record history is presented honestly', async ({ page }) => {
  941  |     test.setTimeout(120_000);
  942  |     await enterArena(page);
  943  | 
  944  |     for (let i = 1; i <= 23; i += 1) {
  945  |       await recordNote(page, `bulk note ${String(i).padStart(2, '0')}`);
  946  |       await expect(page.locator(el.notice)).toContainText(`Recorded sequence ${i}`);
  947  |     }
  948  | 
  949  |     await page.reload();
  950  |     await expect(page.locator(el.projectionVersion)).toHaveText('23');
  951  | 
  952  |     const shown = await page.locator(el.recordItem).count();
  953  |     const notes = await renderedNotes(page);
  954  |     const bodyText = await page.locator('main').innerText();
  955  |     const observed = {
  956  |       recordsWritten: 23,
  957  |       recordsRendered: shown,
  958  |       oldestRendered: notes[notes.length - 1],
  959  |       newestRendered: notes[0],
  960  |       mentionsTruncation: /showing|most recent|older|of 23|20 of/i.test(bodyText),
  961  |     };
  962  |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
  963  |     await page.screenshot({ path: `${EVIDENCE}/s19-01-long-history.png`, fullPage: true });
  964  | 
  965  |     // Either show everything, or say that the list is partial.
  966  |     expect(
  967  |       shown === 23 || observed.mentionsTruncation,
  968  |       'a truncated list should tell the player it is truncated',
  969  |     ).toBe(true);
  970  |   });
  971  | });
  972  | 
  973  | test.describe('Phase 0 independent QA — recovery after an expired session', () => {
  974  |   test('QA-S20 what recovery is actually available after the silent sign-out', async ({ page }) => {
  975  |     const firstAccount = await enterArena(page);
  976  |     await recordNote(page, 'note recorded before expiry');
  977  |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  978  | 
  979  |     await page.evaluate(async () => {
  980  |       await fetch('/api/session', {
  981  |         method: 'DELETE',
  982  |         credentials: 'same-origin',
  983  |         headers: { 'x-hd-candidate': 'cand-0f810c6c26d8' },
  984  |       });
  985  |     });
  986  | 
  987  |     await page.fill(el.noteInput, 'the note in flight');
  988  |     await page.click(el.submit);
  989  |     await expect(page.locator(el.enter)).toBeVisible();
  990  | 
  991  |     // The only control left is "Enter the Local Arena". Take it and see what
  992  |     // the player gets back.
  993  |     await page.click(el.enter);
  994  |     await expect(page.locator(el.accountId)).toBeVisible();
  995  |     const secondAccount = (await page.locator(el.accountId).innerText()).trim();
  996  | 
  997  |     const recovery = {
  998  |       sameAccount: secondAccount === firstAccount,
  999  |       noteInputRestoredTo: await page.locator(el.noteInput).inputValue(),
  1000 |       recordsVisible: await page.locator(el.recordItem).count(),
  1001 |       renderedNotes: await renderedNotes(page),
  1002 |     };
  1003 |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(recovery) });
  1004 |     await page.screenshot({ path: `${EVIDENCE}/s20-01-after-re-entering.png`, fullPage: true });
  1005 | 
  1006 |     // Documented, not asserted as a defect: a new development identity is the
```