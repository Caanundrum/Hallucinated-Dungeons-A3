# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase0-player.qa.spec.ts >> Phase 0 independent QA — failure explanation on the page >> QA-S15 an expired session is explained on the page with a way forward
- Location: scripts/phase0-player.qa.spec.ts:779:7

# Error details

```
Error: the expiry reason should be readable on the page

expect(received).toMatch(expected)

Expected pattern: /session expired/i
Received string:  "Enter the Local Arena·
The server mints a temporary development identity for local testing. There is no password to create or store, and this route exists only in the Local Execution Environment.·
Enter the Local Arena"
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
        - heading "Enter the Local Arena" [level=2] [ref=e16]
        - paragraph [ref=e17]: The server mints a temporary development identity for local testing. There is no password to create or store, and this route exists only in the Local Execution Environment.
        - button "Enter the Local Arena" [ref=e19] [cursor=pointer]
    - contentinfo [ref=e20]: Local Execution Environment only. Canonical state lives in the Firebase Emulator Suite and is disposable.
    - status [ref=e21]: This development session expired. Enter the Local Arena again.
```

# Test source

```ts
  738 |     await expect(page.locator(el.error)).toBeVisible();
  739 |     const errorText = await page.locator(el.error).innerText();
  740 |     expect(errorText.length).toBeGreaterThan(20);
  741 |     expect(errorText).toMatch(/did not respond|Confirm it is running/i);
  742 |     // The failure must not leave a phantom row behind.
  743 |     await expect(page.locator(el.emptyState)).toBeVisible();
  744 |     await page.screenshot({ path: `${EVIDENCE}/s13-01-failure-explained.png`, fullPage: true });
  745 | 
  746 |     await page.click(el.retry);
  747 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  748 |     await expect(page.locator(el.recordNote).first()).toHaveText('note behind a broken connection');
  749 |     await expect(page.locator(el.error)).toHaveCount(0);
  750 |     await page.screenshot({ path: `${EVIDENCE}/s13-02-retry-succeeded.png`, fullPage: true });
  751 |   });
  752 | });
  753 | 
  754 | test.describe('Phase 0 independent QA — failure explanation on the page', () => {
  755 |   test('QA-S14 signing out is confirmed on screen', async ({ page }) => {
  756 |     await enterArena(page);
  757 |     await recordNote(page, 'note before leaving');
  758 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  759 | 
  760 |     await page.click(el.leave);
  761 |     await expect(page.locator(el.enter)).toBeVisible();
  762 | 
  763 |     // The page composes a confirmation ("Session ended. The stored records
  764 |     // remain owned by that account."). A player should be able to read it.
  765 |     const visibleText = await page.locator('main').innerText();
  766 |     const liveRegionText = (await page.locator(el.liveRegion).innerText()).trim();
  767 | 
  768 |     test.info().annotations.push({
  769 |       type: 'observed',
  770 |       description: JSON.stringify({ visibleText, liveRegionText }),
  771 |     });
  772 | 
  773 |     await page.screenshot({ path: `${EVIDENCE}/s14-01-sign-out-confirmation.png`, fullPage: true });
  774 |     expect(visibleText, 'the sign-out confirmation should be readable on the page').toContain(
  775 |       'Session ended',
  776 |     );
  777 |   });
  778 | 
  779 |   test('QA-S15 an expired session is explained on the page with a way forward', async ({ page }) => {
  780 |     await enterArena(page);
  781 |     await recordNote(page, 'note recorded while the session was alive');
  782 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  783 | 
  784 |     // Make the very next write look exactly like a session that aged out.
  785 |     await page.route('**/api/foundation-checks', async (route) => {
  786 |       if (route.request().method() === 'POST') {
  787 |         await route.fulfill({
  788 |           status: 401,
  789 |           contentType: 'application/json; charset=utf-8',
  790 |           body: JSON.stringify({
  791 |             error: 'SESSION_EXPIRED',
  792 |             message: 'This development session expired. Enter the Local Arena again.',
  793 |           }),
  794 |         });
  795 |         return;
  796 |       }
  797 |       await route.continue();
  798 |     });
  799 | 
  800 |     await page.fill(el.noteInput, 'note the player is about to lose');
  801 |     await page.screenshot({ path: `${EVIDENCE}/s15-00-before-expiry.png`, fullPage: true });
  802 |     await page.click(el.submit);
  803 | 
  804 |     // Give the page time to settle into whatever it decided to show.
  805 |     await expect(page.locator(el.enter)).toBeVisible();
  806 |     await page.waitForTimeout(500);
  807 | 
  808 |     const observed = {
  809 |       visibleMainText: await page.locator('main').innerText(),
  810 |       errorElements: await page.locator(el.error).count(),
  811 |       noticeElements: await page.locator(el.notice).count(),
  812 |       retryButtons: await page.locator(el.retry).count(),
  813 |       noteInputs: await page.locator(el.noteInput).count(),
  814 |       liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
  815 |       liveRegionVisibleToSightedUser: await page
  816 |         .locator(el.liveRegion)
  817 |         .evaluate((node) => {
  818 |           const style = window.getComputedStyle(node);
  819 |           const rect = node.getBoundingClientRect();
  820 |           return {
  821 |             className: node.className,
  822 |             width: rect.width,
  823 |             height: rect.height,
  824 |             clip: style.clip,
  825 |             position: style.position,
  826 |           };
  827 |         }),
  828 |     };
  829 |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
  830 | 
  831 |     await page.screenshot({ path: `${EVIDENCE}/s15-01-session-expiry-outcome.png`, fullPage: true });
  832 | 
  833 |     // Phase 0 promises failures are explained on the page with a real retry
  834 |     // path. Both halves are asserted here.
  835 |     expect(
  836 |       observed.visibleMainText,
  837 |       'the expiry reason should be readable on the page',
> 838 |     ).toMatch(/session expired/i);
      |       ^ Error: the expiry reason should be readable on the page
  839 |     expect(observed.errorElements, 'an error message element should be rendered').toBeGreaterThan(0);
  840 |   });
  841 | 
  842 |   test('QA-S16 the same invisibility affects a read that hits an expired session', async ({
  843 |     page,
  844 |   }) => {
  845 |     await enterArena(page);
  846 |     await recordNote(page, 'note before the read fails');
  847 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  848 | 
  849 |     // End the session for real, server-side, while this tab still shows a
  850 |     // signed-in page. This is what a 4-hour expiry looks like to the tab.
  851 |     const ended = await page.evaluate(async () => {
  852 |       const response = await fetch('/api/session', {
  853 |         method: 'DELETE',
  854 |         credentials: 'same-origin',
  855 |         headers: { 'x-hd-candidate': 'cand-0f810c6c26d8' },
  856 |       });
  857 |       return response.status;
  858 |     });
  859 |     expect(ended).toBe(204);
  860 | 
  861 |     // The player, unaware, presses the page's own reload control.
  862 |     await page.click(el.refresh);
  863 |     await expect(page.locator(el.enter)).toBeVisible();
  864 |     await page.waitForTimeout(300);
  865 | 
  866 |     const observed = {
  867 |       visibleMainText: await page.locator('main').innerText(),
  868 |       errorElements: await page.locator(el.error).count(),
  869 |       liveRegionText: (await page.locator(el.liveRegion).innerText()).trim(),
  870 |     };
  871 |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
  872 |     await page.screenshot({ path: `${EVIDENCE}/s16-01-expired-read-outcome.png`, fullPage: true });
  873 | 
  874 |     expect(
  875 |       observed.visibleMainText,
  876 |       'the page should say why it stopped showing the records',
  877 |     ).toMatch(/enter the local arena before|session expired/i);
  878 |   });
  879 | });
  880 | 
  881 | test.describe('Phase 0 independent QA — announcement and focus behaviour', () => {
  882 |   test('QA-S17 the polite live region survives a state change so it can announce', async ({
  883 |     page,
  884 |   }) => {
  885 |     await enterArena(page);
  886 | 
  887 |     // Tag the live region node, then cause a state change, then see whether the
  888 |     // tagged node is still the one on the page. A screen reader only announces
  889 |     // a polite region that already existed when its text changed.
  890 |     await page.evaluate(() => {
  891 |       const region = document.querySelector('[data-testid="live-region"]');
  892 |       (region as HTMLElement & { __qaTag?: string }).__qaTag = 'original';
  893 |     });
  894 | 
  895 |     await recordNote(page, 'live region persistence probe');
  896 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  897 | 
  898 |     const survived = await page.evaluate(() => {
  899 |       const region = document.querySelector('[data-testid="live-region"]');
  900 |       return {
  901 |         sameNode: (region as HTMLElement & { __qaTag?: string })?.__qaTag === 'original',
  902 |         text: (region?.textContent ?? '').trim(),
  903 |       };
  904 |     });
  905 |     test.info().annotations.push({ type: 'observed', description: JSON.stringify(survived) });
  906 |     expect(survived.sameNode, 'the live region should persist across renders').toBe(true);
  907 |   });
  908 | 
  909 |   test('QA-S18 focus is retained near the control the player just used', async ({ page }) => {
  910 |     await enterArena(page);
  911 |     await page.focus(el.noteInput);
  912 |     await page.keyboard.type('focus retention probe');
  913 |     await page.keyboard.press('Enter');
  914 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  915 | 
  916 |     const afterSubmit = await page.evaluate(() => ({
  917 |       tag: document.activeElement?.tagName ?? null,
  918 |       testId: document.activeElement?.getAttribute('data-testid') ?? null,
  919 |     }));
  920 | 
  921 |     await page.click(el.refresh);
  922 |     await expect(page.locator(el.notice)).toContainText('Reloaded');
  923 |     const afterRefresh = await page.evaluate(() => ({
  924 |       tag: document.activeElement?.tagName ?? null,
  925 |       testId: document.activeElement?.getAttribute('data-testid') ?? null,
  926 |     }));
  927 | 
  928 |     test.info().annotations.push({
  929 |       type: 'observed',
  930 |       description: JSON.stringify({ afterSubmit, afterRefresh }),
  931 |     });
  932 | 
  933 |     expect(afterSubmit.tag, 'focus should not be dumped on <body> after submitting').not.toBe(
  934 |       'BODY',
  935 |     );
  936 |   });
  937 | });
  938 | 
```