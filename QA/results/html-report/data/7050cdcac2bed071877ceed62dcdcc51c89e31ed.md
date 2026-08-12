# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase0-player.qa.spec.ts >> Phase 0 independent QA — completeness of what is shown >> QA-S19 a long record history is presented honestly
- Location: scripts/phase0-player.qa.spec.ts:940:7

# Error details

```
Error: a truncated list should tell the player it is truncated

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - link "Skip to main content" [ref=f1e2] [cursor=pointer]:
    - /url: "#main"
  - generic [ref=f1e4]:
    - banner [ref=f1e5]:
      - heading "Hallucinated Dungeons — Local Arena" [level=1] [ref=f1e6]
      - paragraph [ref=f1e7]: "Phase 0 greenfield foundation. This page proves the browser, local server, and Firebase emulators form one authenticated write and read path. It is not the game: characters, campaigns, the tactical map, and the AI Game Director are built in later phases."
    - generic [ref=f1e8]:
      - generic [ref=f1e9]: Candidate cand-0f810c6c26d8
      - generic [ref=f1e10]: Environment local
      - generic [ref=f1e11]: Mode frozen_certification
      - generic [ref=f1e12]: Emulator project hallucinated-dungeons-local
      - generic [ref=f1e13]: Blueprint ALPHA_3_V1
    - main [ref=f1e14]:
      - region [ref=f1e15]:
        - heading "Signed in for local testing" [level=2] [ref=f1e16]
        - paragraph [ref=f1e17]: Account dev-415b87a3-b596-4906-b78e-58168c82dc12 (Local Builder 415b87), session expires 8/12/2026, 8:21:14 PM.
        - button "Leave the Local Arena" [ref=f1e19] [cursor=pointer]
      - region [ref=f1e20]:
        - heading "Record a foundation check" [level=2] [ref=f1e21]
        - paragraph [ref=f1e22]: Recording a check sends your note to the local server, which authorizes it, writes it to the Firestore emulator, and returns the stored projection. The list below is always the server's answer, never a local copy of what you typed.
        - generic [ref=f1e23]:
          - generic [ref=f1e24]: Foundation check note
          - textbox "Foundation check note" [ref=f1e25]
          - paragraph [ref=f1e26]: Up to 120 characters. Submitting the same attempt twice returns the original record instead of writing a second one.
          - generic [ref=f1e27]:
            - button "Record foundation check" [ref=f1e28] [cursor=pointer]
            - button "Reload from server" [ref=f1e29] [cursor=pointer]
      - region [ref=f1e30]:
        - heading "Stored for this account" [level=2] [ref=f1e31]
        - paragraph [ref=f1e32]: Projection version 23.
        - list [ref=f1e33]:
          - listitem [ref=f1e34]:
            - generic [ref=f1e35]: bulk note 23
            - text: Sequence 23 · recorded 8/12/2026, 4:21:15 PM · id 7795c1ce-cd89-4ae1-a976-aaf31d2d7671
          - listitem [ref=f1e36]:
            - generic [ref=f1e37]: bulk note 22
            - text: Sequence 22 · recorded 8/12/2026, 4:21:15 PM · id 82b25976-7974-470d-b3d2-4dd538c0bf96
          - listitem [ref=f1e38]:
            - generic [ref=f1e39]: bulk note 21
            - text: Sequence 21 · recorded 8/12/2026, 4:21:15 PM · id 81a3be23-5fad-4210-9353-8553e67ced46
          - listitem [ref=f1e40]:
            - generic [ref=f1e41]: bulk note 20
            - text: Sequence 20 · recorded 8/12/2026, 4:21:15 PM · id b6ca4e62-3386-4aae-b479-3c59b1f93bca
          - listitem [ref=f1e42]:
            - generic [ref=f1e43]: bulk note 19
            - text: Sequence 19 · recorded 8/12/2026, 4:21:15 PM · id 0e647204-5a1b-4dcb-9407-b12939947ca7
          - listitem [ref=f1e44]:
            - generic [ref=f1e45]: bulk note 18
            - text: Sequence 18 · recorded 8/12/2026, 4:21:15 PM · id ff45bdd8-2208-496a-ad50-67aedf00e906
          - listitem [ref=f1e46]:
            - generic [ref=f1e47]: bulk note 17
            - text: Sequence 17 · recorded 8/12/2026, 4:21:15 PM · id 8a857994-4de7-404b-af73-e18a5c709694
          - listitem [ref=f1e48]:
            - generic [ref=f1e49]: bulk note 16
            - text: Sequence 16 · recorded 8/12/2026, 4:21:15 PM · id ceaa1f0b-03db-49d0-9d2f-125c4f4eeaaa
          - listitem [ref=f1e50]:
            - generic [ref=f1e51]: bulk note 15
            - text: Sequence 15 · recorded 8/12/2026, 4:21:15 PM · id 892b638b-6a44-4d28-bcd5-7d1002ceadf9
          - listitem [ref=f1e52]:
            - generic [ref=f1e53]: bulk note 14
            - text: Sequence 14 · recorded 8/12/2026, 4:21:15 PM · id 2aedcf8d-00bc-4b07-869f-83b46f733358
          - listitem [ref=f1e54]:
            - generic [ref=f1e55]: bulk note 13
            - text: Sequence 13 · recorded 8/12/2026, 4:21:15 PM · id 891dd46d-50b4-480c-95c4-d973b81f5490
          - listitem [ref=f1e56]:
            - generic [ref=f1e57]: bulk note 12
            - text: Sequence 12 · recorded 8/12/2026, 4:21:14 PM · id d6cfd8d3-2295-4f35-b418-a700e2374c4f
          - listitem [ref=f1e58]:
            - generic [ref=f1e59]: bulk note 11
            - text: Sequence 11 · recorded 8/12/2026, 4:21:14 PM · id 4cf4a135-3550-41a5-85d6-65c26b778240
          - listitem [ref=f1e60]:
            - generic [ref=f1e61]: bulk note 10
            - text: Sequence 10 · recorded 8/12/2026, 4:21:14 PM · id 6e0e0930-df06-41c1-bde1-f71f4ef502d3
          - listitem [ref=f1e62]:
            - generic [ref=f1e63]: bulk note 09
            - text: Sequence 9 · recorded 8/12/2026, 4:21:14 PM · id 9ed8ada1-66ea-4965-9c91-1b3dcc0fb869
          - listitem [ref=f1e64]:
            - generic [ref=f1e65]: bulk note 08
            - text: Sequence 8 · recorded 8/12/2026, 4:21:14 PM · id a478c6dd-a274-4dee-89a4-ed02d42ec849
          - listitem [ref=f1e66]:
            - generic [ref=f1e67]: bulk note 07
            - text: Sequence 7 · recorded 8/12/2026, 4:21:14 PM · id 420c8710-cd45-4166-9eed-657023986b0f
          - listitem [ref=f1e68]:
            - generic [ref=f1e69]: bulk note 06
            - text: Sequence 6 · recorded 8/12/2026, 4:21:14 PM · id d16340fc-281a-43bf-b74c-df8f88118bed
          - listitem [ref=f1e70]:
            - generic [ref=f1e71]: bulk note 05
            - text: Sequence 5 · recorded 8/12/2026, 4:21:14 PM · id 4cc142b7-e5c6-4c0a-ba67-fc0cf3f4d3a7
          - listitem [ref=f1e72]:
            - generic [ref=f1e73]: bulk note 04
            - text: Sequence 4 · recorded 8/12/2026, 4:21:14 PM · id e71cc0ab-37a9-42c2-9c02-bbc4827fccba
    - contentinfo [ref=f1e74]: Local Execution Environment only. Canonical state lives in the Firebase Emulator Suite and is disposable.
    - status [ref=f1e75]
```

# Test source

```ts
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
  906  |     expect(survived.sameNode, 'the live region should persist across renders').toBe(true);
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
> 969  |     ).toBe(true);
       |       ^ Error: a truncated list should tell the player it is truncated
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
  1007 |     // designed behaviour. The finding is that none of this was explained.
  1008 |     expect(recovery.sameAccount).toBe(false);
  1009 |   });
  1010 | });
  1011 | 
  1012 | /** Presses Tab until the given selector holds focus, or gives up. */
  1013 | async function tabTo(page: Page, selector: string, maxPresses = 12): Promise<boolean> {
  1014 |   for (let i = 0; i < maxPresses; i += 1) {
  1015 |     const focused = await page.evaluate(
  1016 |       (target) => document.activeElement === document.querySelector(target),
  1017 |       selector,
  1018 |     );
  1019 |     if (focused) {
  1020 |       return true;
  1021 |     }
  1022 |     await page.keyboard.press('Tab');
  1023 |   }
  1024 |   return page.evaluate(
  1025 |     (target) => document.activeElement === document.querySelector(target),
  1026 |     selector,
  1027 |   );
  1028 | }
  1029 | 
  1030 | /** Lists every focusable control the page currently renders. */
  1031 | async function interactiveInventory(page: Page): Promise<string[]> {
  1032 |   return page.evaluate(() => {
  1033 |     const nodes = document.querySelectorAll('a[href], button, input, select, textarea');
  1034 |     return Array.from(nodes).map((node) => {
  1035 |       const tag = node.tagName.toLowerCase();
  1036 |       const label =
  1037 |         tag === 'input'
  1038 |           ? (node.getAttribute('data-testid') ?? node.getAttribute('name') ?? 'unnamed')
  1039 |           : (node.textContent ?? '').trim().replace(/\s+/g, ' ');
  1040 |       return `${tag}:${label}`;
  1041 |     });
  1042 |   });
  1043 | }
  1044 | 
```