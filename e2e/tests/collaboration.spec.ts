import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "password123";

function uniqueEmail(name: string) {
  return `${name.toLowerCase()}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

async function register(page: Page, name: string, email: string) {
  await page.goto("/");
  // In login mode the only "Register" button switches the form to sign-up.
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
}

test("two people edit the same workspace in real time", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  const bobEmail = uniqueEmail("Bob");

  await register(alice, "Alice", uniqueEmail("Alice"));
  await register(bob, "Bob", bobEmail);

  // Alice creates a workspace and lands on its own URL.
  await alice.getByLabel("Workspace name").fill("Team notes");
  await alice.getByRole("button", { name: "Create", exact: true }).click();
  await expect(alice.getByRole("heading", { name: "Team notes" })).toBeVisible();
  await expect(alice).toHaveURL(/#\/w\/[a-f\d]{24}$/);
  const workspaceUrl = alice.url();

  // Bob can't open it before he is invited.
  await bob.goto(workspaceUrl);
  await expect(bob.getByRole("heading", { name: "Workspace unavailable" })).toBeVisible();

  // Alice invites Bob by email.
  await alice.getByLabel("Email").fill(bobEmail);
  await alice.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(alice.getByText(`Added Bob (${bobEmail})`)).toBeVisible();

  // Now the same link works for Bob.
  await bob.reload();
  const aliceEditor = alice.getByRole("textbox", { name: "Document" });
  const bobEditor = bob.getByRole("textbox", { name: "Document" });
  await expect(aliceEditor).toBeEditable();
  await expect(bobEditor).toBeEditable();

  // Each sees the other.
  await expect(alice.getByRole("list", { name: "People here now" })).toContainText("Bob");
  await expect(bob.getByRole("list", { name: "People here now" })).toContainText("Alice");

  // Alice types; Bob sees it.
  await aliceEditor.click();
  await aliceEditor.pressSequentially("Hello from Alice.", { delay: 15 });
  await expect(bobEditor).toHaveValue("Hello from Alice.");

  // Bob appends; Alice sees it.
  await bobEditor.click();
  await bob.keyboard.press("Control+End");
  await bobEditor.pressSequentially(" Hi, Bob here.", { delay: 15 });
  const sequential = "Hello from Alice. Hi, Bob here.";
  await expect(aliceEditor).toHaveValue(sequential);

  // Both type at the same time, at opposite ends: nothing is lost, and both
  // end up with the same text.
  await aliceEditor.click();
  await alice.keyboard.press("Control+Home");
  await bobEditor.click();
  await bob.keyboard.press("Control+End");
  await Promise.all([
    aliceEditor.pressSequentially("[A] ", { delay: 40 }),
    bobEditor.pressSequentially(" [B]", { delay: 40 })
  ]);
  const merged = `[A] ${sequential} [B]`;
  await expect(aliceEditor).toHaveValue(merged);
  await expect(bobEditor).toHaveValue(merged);
  await expect(alice.getByText("All changes saved")).toBeVisible();
  await expect(bob.getByText("All changes saved")).toBeVisible();

  // The text is saved: it survives a reload.
  await bob.reload();
  await expect(bob.getByRole("textbox", { name: "Document" })).toHaveValue(merged);

  // The activity log says who did what.
  await expect(alice.getByRole("list", { name: "Activity" })).toContainText("Alice invited Bob");
});

test("a workspace link opens after signing in", async ({ page }) => {
  const email = uniqueEmail("Carol");
  await register(page, "Carol", email);
  await page.getByLabel("Workspace name").fill("Deep link");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#\/w\/[a-f\d]{24}$/);
  const workspaceUrl = page.url();

  // Sign out, then open the link: sign in first, then land on the workspace.
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await page.goto(workspaceUrl);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deep link" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document" })).toBeEditable();
});
