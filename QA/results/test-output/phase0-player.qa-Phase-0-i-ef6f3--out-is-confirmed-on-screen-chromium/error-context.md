# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase0-player.qa.spec.ts >> Phase 0 independent QA — failure explanation on the page >> QA-S14 signing out is confirmed on screen
- Location: scripts/phase0-player.qa.spec.ts:755:7

# Error details

```
Error: the sign-out confirmation should be readable on the page

expect(received).toContain(expected) // indexOf

Expected substring: "Session ended"
Received string:    "Enter the Local Arena·
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
    - status [ref=e21]: Session ended. The stored records remain owned by that account.
```

# Test source

```ts
  674 | 
  675 |     const attackResult = await attacker.evaluate(async () => {
  676 |       const attempt = async (init: RequestInit) => {
  677 |         try {
  678 |           const response = await fetch('http://127.0.0.1:5274/api/foundation-checks', init);
  679 |           return { blocked: false, status: response.status, body: await response.text() };
  680 |         } catch (error) {
  681 |           return { blocked: true, reason: String(error) };
  682 |         }
  683 |       };
  684 |       return {
  685 |         readWithCredentials: await attempt({ credentials: 'include' }),
  686 |         writeWithCredentials: await attempt({
  687 |           method: 'POST',
  688 |           credentials: 'include',
  689 |           headers: { 'content-type': 'application/json', 'x-hd-candidate': 'cand-0f810c6c26d8' },
  690 |           body: JSON.stringify({
  691 |             requestId: '55555555-5555-4555-8555-555555555555',
  692 |             note: 'written from evil.test',
  693 |           }),
  694 |         }),
  695 |       };
  696 |     });
  697 | 
  698 |     // Either the browser blocked it or the server refused it; in no case may
  699 |     // the attacker page obtain records.
  700 |     expect(JSON.stringify(attackResult)).not.toContain('cross origin target note');
  701 |     expect(
  702 |       attackResult.readWithCredentials.blocked || attackResult.readWithCredentials.status === 403,
  703 |     ).toBe(true);
  704 |     expect(
  705 |       attackResult.writeWithCredentials.blocked || attackResult.writeWithCredentials.status === 403,
  706 |     ).toBe(true);
  707 | 
  708 |     test.info().annotations.push({
  709 |       type: 'cross-origin-outcome',
  710 |       description: JSON.stringify(attackResult),
  711 |     });
  712 | 
  713 |     await attacker.close();
  714 | 
  715 |     // The victim account is untouched.
  716 |     await page.reload();
  717 |     await expect(page.locator(el.recordItem)).toHaveCount(1);
  718 |     expect(await renderedNotes(page)).toEqual(['cross origin target note']);
  719 |     await page.screenshot({ path: `${EVIDENCE}/s12-01-cross-origin-no-effect.png`, fullPage: true });
  720 |   });
  721 | 
  722 |   test('QA-S13 a server failure is explained on the page and offers a real retry', async ({
  723 |     page,
  724 |   }) => {
  725 |     await enterArena(page);
  726 | 
  727 |     let failNext = true;
  728 |     await page.route('**/api/foundation-checks', async (route) => {
  729 |       if (route.request().method() === 'POST' && failNext) {
  730 |         failNext = false;
  731 |         await route.abort('connectionfailed');
  732 |         return;
  733 |       }
  734 |       await route.continue();
  735 |     });
  736 | 
  737 |     await recordNote(page, 'note behind a broken connection');
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
> 774 |     expect(visibleText, 'the sign-out confirmation should be readable on the page').toContain(
      |                                                                                     ^ Error: the sign-out confirmation should be readable on the page
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
  838 |     ).toMatch(/session expired/i);
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
```