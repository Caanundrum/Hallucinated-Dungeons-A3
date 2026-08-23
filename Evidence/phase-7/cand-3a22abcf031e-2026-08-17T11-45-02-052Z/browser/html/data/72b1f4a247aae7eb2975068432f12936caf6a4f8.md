# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase6-a11y-wcag.spec.ts >> Phase 6 core-loop a11y (automated WCAG) >> landmarks, keyboard Characters path, reduced motion/low effects, high zoom, named controls
- Location: tests/e2e/phase6-a11y-wcag.spec.ts:79:3

# Error details

```
Error: expect(locator).toHaveClass(expected) failed

Locator: locator('html')
Expected pattern: /hd-reduced-motion/
Received string:  ""
Timeout: 10000ms

Call log:
  - Expect "toHaveClass" with timeout 10000ms
  - waiting for locator('html')
    24 × locator resolved to <html class="" lang="en" data-low-effects="false" data-reduced-motion="false">…</html>
       - unexpected value ""

```

```yaml
- document:
  - link "Skip to main content":
    - /url: "#main"
  - banner
  - main
  - contentinfo
  - status: Reduced motion applied on the tactical table.
```

# Test source

```ts
  7   |  *
  8   |  * Blueprint ownership: Section 25 Phase 6 build scope item 2 ("WCAG 2.2 AA
  9   |  * core-loop certification" via keyboard / high-zoom / reduced-motion /
  10  |  * low-effects). Real Safari / screen-reader AT remains
  11  |  * BLOCKED_FOR_FINAL_DEVICE_CERTIFICATION on this host.
  12  |  */
  13  | 
  14  | const TABLE_PRIMARY_CONTROLS = [
  15  |   'claim-active-turn',
  16  |   'end-active-turn',
  17  |   'refresh-table-projection',
  18  |   'commit-table-sync',
  19  |   'commit-table-move',
  20  |   'open-adjacent-door',
  21  |   'interpret-action',
  22  | ] as const;
  23  | 
  24  | async function dismissIntroIfPresent(page: Page): Promise<void> {
  25  |   const skip = page.getByTestId('skip-intro');
  26  |   if (await skip.isVisible().catch(() => false)) {
  27  |     await skip.click();
  28  |   }
  29  | }
  30  | 
  31  | async function signIn(page: Page): Promise<void> {
  32  |   await page.goto('/');
  33  |   await dismissIntroIfPresent(page);
  34  |   await enterAccountFromShell(page);
  35  | }
  36  | 
  37  | async function createQuickCharacter(page: Page, name: string): Promise<void> {
  38  |   await page.getByTestId('nav-characters').click();
  39  |   await expect(page.getByTestId('vault-heading')).toBeVisible();
  40  |   await page.getByTestId('start-character').click();
  41  |   const tutorialNo = page.getByTestId('tutorial-ask-no');
  42  |   if (await tutorialNo.isVisible().catch(() => false)) {
  43  |     await tutorialNo.click();
  44  |   }
  45  |   await page.getByTestId('open-quick-start').click();
  46  |   await page.getByTestId('option-stalwart-defender').click();
  47  |   await expect(page.getByTestId('active-step-heading')).toHaveText('Identity & Final Review');
  48  |   await page.getByTestId('identity-name').fill(name);
  49  |   await page.getByTestId('identity-name').dispatchEvent('change');
  50  |   await expect(page.getByTestId('nothing-unresolved')).toBeVisible();
  51  |   await page.getByTestId('create-character').click();
  52  |   await expect(page.getByTestId('character-sheet-heading')).toHaveText(name);
  53  | }
  54  | 
  55  | /** Creates a campaign leaving the Emberferry Crossing starter template selected (the default). */
  56  | async function createEmberferryCampaign(page: Page, name: string): Promise<string> {
  57  |   await page.getByTestId('nav-campaigns').click();
  58  |   await page.getByTestId('start-campaign').click();
  59  |   await expect(page.getByTestId('adventure-template-emberferry_crossing')).toHaveClass(/selected/);
  60  |   await page.getByTestId('campaign-name').fill(name);
  61  |   await page.getByTestId('campaign-name').dispatchEvent('change');
  62  |   await page.getByTestId('identity-veyra').click();
  63  |   await page.getByTestId('personality-seasoned_host').click();
  64  |   await page.getByTestId('create-campaign-submit').click();
  65  |   await expect(page.getByTestId('campaign-detail-heading')).toHaveText(name);
  66  |   return page.url().split('/').pop()!;
  67  | }
  68  | 
  69  | async function seatOwnCharacter(page: Page): Promise<void> {
  70  |   const seatSelect = page.getByTestId('seat-character-select');
  71  |   const characterId = await seatSelect.locator('option').nth(1).getAttribute('value');
  72  |   expect(characterId).toBeTruthy();
  73  |   await seatSelect.selectOption(characterId!);
  74  |   await page.getByTestId('create-seat').click();
  75  |   await expect(page.getByTestId('own-seat')).toBeVisible();
  76  | }
  77  | 
  78  | test.describe('Phase 6 core-loop a11y (automated WCAG)', () => {
  79  |   test('landmarks, keyboard Characters path, reduced motion/low effects, high zoom, named controls', async ({
  80  |     page,
  81  |   }) => {
  82  |     test.setTimeout(90_000);
  83  | 
  84  |     await signIn(page);
  85  | 
  86  |     // Shell landmarks from index.html + shell.ts (skip-link / #main / live-region).
  87  |     await expect(page.locator('a.skip-link')).toBeVisible();
  88  |     await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
  89  |     await expect(page.locator('#main')).toBeVisible();
  90  |     await expect(page.getByRole('main')).toBeVisible();
  91  |     await expect(page.getByTestId('live-region')).toBeAttached();
  92  | 
  93  |     // Keyboard: reach primary nav Characters and activate it with Enter.
  94  |     await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  95  |     await page.getByTestId('nav-characters').focus();
  96  |     await expect(page.getByTestId('nav-characters')).toBeFocused();
  97  |     await page.keyboard.press('Enter');
  98  |     await expect(page.getByTestId('vault-heading')).toBeVisible();
  99  | 
  100 |     await createQuickCharacter(page, 'Phase6 A11y Scout');
  101 |     await createEmberferryCampaign(page, 'Phase6 A11y Table');
  102 |     await seatOwnCharacter(page);
  103 |     await page.getByTestId('open-campaign-table').click();
  104 |     await expect(page.getByTestId('claim-active-turn')).toBeVisible();
  105 | 
  106 |     await page.getByTestId('table-reduced-motion').check();
> 107 |     await expect(page.locator('html')).toHaveClass(/hd-reduced-motion/);
      |                                        ^ Error: expect(locator).toHaveClass(expected) failed
  108 |     await page.getByTestId('table-low-effects').check();
  109 |     await expect(page.locator('html')).toHaveClass(/hd-low-effects/);
  110 | 
  111 |     // High zoom / large viewport: table primary control remains operable.
  112 |     await page.setViewportSize({ width: 1600, height: 900 });
  113 |     await page.evaluate(() => {
  114 |       document.documentElement.style.zoom = '2';
  115 |     });
  116 |     await expect(page.getByTestId('claim-active-turn')).toBeVisible();
  117 |     await expect(page.getByTestId('claim-active-turn')).toHaveAttribute('aria-disabled', 'false');
  118 | 
  119 |     for (const testId of TABLE_PRIMARY_CONTROLS) {
  120 |       const control = page.getByTestId(testId);
  121 |       await expect(control).toBeVisible();
  122 |       await expect(control).toHaveAccessibleName(/.+/);
  123 |     }
  124 |   });
  125 | });
  126 | 
```