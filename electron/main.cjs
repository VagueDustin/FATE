const { app, BrowserWindow, ipcMain, shell, protocol, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const DiscordRPC = require('discord-rpc');
const Store = require('electron-store');

/**
 * ProgId that electron-builder's NSIS installer actually registers for `.md`.
 *
 * This is taken from `build.fileAssociations[].name` in package.json — NOT from
 * `build.appx.applicationId` as previously assumed. Verified against a real install:
 *
 *     HKLM\SOFTWARE\Classes\.md                       (default) = "Markdown Document"
 *     HKLM\SOFTWARE\Classes\Markdown Document\shell\open\command
 *         = "C:\Program Files\FATE\FATE - Markdown Viewer\FATE - Markdown Viewer.exe" "%1"
 *
 * It is only a HINT here. Because "Markdown Document" is a generic name that another application
 * could plausibly claim, `getDefaultAppStatus()` does not trust it — it resolves the ProgId's open
 * command and checks that the command actually points at THIS executable. See below.
 */
const MD_PROG_ID_HINT = 'Markdown Document';

/**
 * ProgId the installer registers for code files (see build/installer.nsh). Unlike `.md`, code
 * extensions are NEVER claimed as defaults by the installer — the ProgId is attached to each
 * extension's OpenWithProgids list (adds FATE to "Open with" without touching anyone's default)
 * and declared under FATE's Capabilities so every type is offered on FATE's page in Windows
 * Settings → Default apps.
 */
const CODE_PROG_ID = 'FATE.CodeFile';

/** How many recent documents to remember. Eight fills the home-screen panel without scrolling. */
const MAX_RECENT_FILES = 8;

/* ════════════════════════════════════════════════════════════════════════════════════════════
   FILE TYPES
   The main process reads bytes and watches paths; it does not care what a file *is*. These lists
   exist only to (a) build the open-dialog filters and (b) keep handleArgs from trying to "open"
   the installer's own flags or a random DLL passed on the command line. The renderer owns the
   markdown-vs-code routing decision (see fileKindForName in App.jsx).
   ════════════════════════════════════════════════════════════════════════════════════════════ */

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'];

/** Code files offered in the open dialog and accepted from the command line. */
const CODE_EXTENSIONS = [
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less',
  'ps1', 'psm1', 'psd1', 'py', 'pyw', 'rb', 'php', 'sql',
  'xml', 'xsl', 'svg', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'bat', 'cmd',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx', 'cs', 'java', 'go', 'rs',
  'swift', 'kt', 'kts', 'dart', 'lua', 'r', 'pl', 'pm', 'scala', 'groovy', 'gradle',
  'vue', 'svelte', 'tex', 'diff', 'patch', 'log', 'env',
  'proto', 'graphql', 'gql', 'vb', 'fs', 'fsx', 'erl', 'ex', 'exs', 'hs',
  'clj', 'cljs', 'edn', 'nim', 'zig', 'jl', 'asm'
];

/**
 * Types FATE must NEVER register against in any way — not even "politely".
 *
 * `.bat` and `.cmd` resolve to the system ProgIds `batfile`/`cmdfile`, whose open command is
 * `"%1" %*`: the script IS the executable. Two consequences, and the second one is the trap.
 *
 *  1. No application name appears in that command, so Windows' "Choose a default" picker has
 *     nothing to offer for putting it back. Losing the default is a ONE-WAY DOOR.
 *
 *  2. MERELY BEING LISTED in the type's `OpenWithProgids` breaks it. Windows then sees two
 *     candidate handlers with no UserChoice to arbitrate, and shows "Pick an app" instead of
 *     running the script. Measured directly: `.reg` ran its handler normally, gained ONE
 *     OpenWithProgids entry, and immediately started showing the picker; removing the entry
 *     restored it. So the harmless-looking `OpenWithProgids` registration that makes FATE a
 *     polite option for `.py` is destructive for any type whose handler is a system ProgId that
 *     runs the file itself.
 *
 * Up to 1.11.5 both were registered like every other code type, which broke `.cmd` outright and
 * `.bat` twice over (the registration, plus a UserChoice for anyone who then picked FATE on its
 * Default-apps page).
 *
 * This is about REGISTRATION only. Both stay in CODE_EXTENSIONS, so the open dialog, drag & drop,
 * the command line and "Edit in FATE" all still open them — FATE just never advertises itself as
 * a handler.
 */
const PROTECTED_EXTENSIONS = ['bat', 'cmd'];

/** Every type FATE may register against: what the installer writes and the coverage counter walks. */
const ASSOCIABLE_CODE_EXTENSIONS = CODE_EXTENSIONS.filter((e) => !PROTECTED_EXTENSIONS.includes(e));
const ASSOCIABLE_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...ASSOCIABLE_CODE_EXTENSIONS];

/** Extensionless files that are obviously code. `path.extname('.gitignore')` is '' — hence names. */
const SPECIAL_CODE_BASENAMES = [
  'dockerfile', 'makefile', 'cmakelists.txt', '.gitignore', '.gitattributes',
  '.editorconfig', '.env', '.npmrc', '.prettierrc', '.eslintrc'
];

/**
 * Refuse files above this size rather than feeding them to the renderer. 25 MB of text is already
 * an unpleasant document; past that the single-string IPC payload and the editor both suffer, and
 * the likeliest candidates (giant logs, minified bundles) aren't things FATE is for.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Would FATE know what to do with this path? Used by handleArgs and the drop of a dialog pick. */
function isOpenableFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (SPECIAL_CODE_BASENAMES.includes(base)) return true;
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(ext) || CODE_EXTENSIONS.includes(ext);
}

/**
 * Cheap binary sniff: a NUL byte in the first 8 KB. Text encodings FATE can read (UTF-8, ASCII)
 * never contain NUL; executables, images and archives contain them almost immediately. This is a
 * guard against "Open with FATE" on the wrong file, not a general-purpose detector.
 */
function isProbablyBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

/**
 * The registered application name (Windows Settings, RegisteredApplications) and the home-screen
 * window title. Renamed from "FATE - Markdown Viewer" in 1.11.0 — the app is a full editor now.
 */
const APP_TITLE = 'FATE - Formatted Article & Text Editor';

/**
 * The window title. Since 1.11.0, BY EXPLICIT CHOICE, an open document titles the window with just
 * its filename (plus the unsaved •); the full app name shows only on the home screen. Yes, that
 * means the taskbar label leads with the filename — that is the requested behaviour, superseding
 * the pre-1.11 "app name must lead" rule.
 *
 * Composition still lives here rather than in the renderer so there is exactly one place that
 * decides what the window is called.
 */
function composeTitle(docName, edited) {
  return docName ? `${docName}${edited ? ' •' : ''}` : APP_TITLE;
}

/*
 * Dev/test escape hatch: point userData somewhere else so a test instance can run beside a real
 * installed FATE (the single-instance lock and the Chromium profile are both scoped to userData).
 * Must run before Store() below touches the path. No effect unless the env var is set.
 */
if (process.env.FATE_USER_DATA) {
  app.setPath('userData', process.env.FATE_USER_DATA);
}

const store = new Store({
  defaults: {
    // 'fate' = VagueDustin Enterprises navy & gold (utility tier), the default since 1.5.0.
    // Installs carrying the pre-1.5.0 'dark' value are migrated to 'fate' in the renderer — see
    // resolveTheme() in src/App.jsx. 'dark' no longer has a token block, so it must not survive.
    theme: 'fate',
    autoUpdatesEnabled: true,
    sidebarWidth: 300,
    shortcuts: {
      openFile: 'Control+O',
      print: 'Control+P',
      close: 'Escape'
    },
    recentFiles: [],
    // Page setup for print preview and PDF export. 'Letter' rather than 'A4' because the app is
    // Windows-only and US Letter is the more common default there; both are offered in Settings.
    printPageSize: 'Letter',
    printLandscape: false
  }
});

/*
 * Drop settings that no longer exist, so an upgraded install doesn't carry dead keys forever.
 *
 * `discordEnabled` backed the "Show filename on Discord" toggle, removed in 1.8.0. Deleting it here
 * rather than leaving it means the on-disk config matches what the app actually reads.
 */
for (const staleKey of ['discordEnabled']) {
  if (store.has(staleKey)) store.delete(staleKey);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   RECENT DOCUMENTS
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Record a document in the recents list: newest first, de-duplicated by path, capped.
 * Stores only the path and a timestamp — the display name and existence check are derived on read,
 * so a moved or renamed file cannot leave a stale name behind in the store.
 */
function rememberRecentFile(filePath) {
  const existing = store.get('recentFiles') || [];
  const normalized = path.normalize(filePath);
  const deduped = existing.filter(
    (entry) => path.normalize(entry.path || '').toLowerCase() !== normalized.toLowerCase()
  );
  deduped.unshift({ path: normalized, openedAt: Date.now() });
  store.set('recentFiles', deduped.slice(0, MAX_RECENT_FILES));
}

/**
 * Read the recents list, annotating each entry with its display name and whether it still exists.
 * Missing files are returned rather than filtered out so the UI can show them greyed with a reason
 * — silently dropping an entry looks like the app forgot the file.
 */
function readRecentFiles() {
  const entries = store.get('recentFiles') || [];
  return entries.map((entry) => ({
    path: entry.path,
    name: path.basename(entry.path),
    dir: path.dirname(entry.path),
    openedAt: entry.openedAt,
    exists: fs.existsSync(entry.path)
  }));
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   DEFAULT-APP ASSOCIATION (Windows)
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/** Promise wrapper around `reg query`. Resolves the raw stdout, or null on any failure. */
function regQuery(args) {
  return new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true }, (err, stdout) => {
      resolve(err || !stdout ? null : stdout);
    });
  });
}

/**
 * Read the ProgId Windows currently uses to open a given extension.
 *
 * ── The key that matters ──────────────────────────────────────────────────────────────────────
 * This reads:
 *     HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\<ext>\UserChoice
 *
 * NOT `HKCU\Software\Classes\<ext>\UserChoice`, which is where an earlier version of this function
 * looked. That key does not exist on Windows 10/11 — the result was that FATE reported "no app is
 * set for .md files yet" even when Windows Settings plainly showed FATE as the handler. The
 * FileExts location is the one Explorer actually consults and the one the Settings UI writes.
 *
 * Note the value is NOT quoted in `reg` output and the ProgId can contain spaces (ours is
 * "Markdown Document"), so the capture runs to end-of-line rather than to the first whitespace.
 *
 * Resolves null when there is no explicit user choice yet.
 */
async function readUserChoiceProgId(ext) {
  if (process.platform !== 'win32') return null;
  const stdout = await regQuery([
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
    '/v',
    'ProgId'
  ]);
  if (!stdout) return null;
  // "    ProgId    REG_SZ    Markdown Document"
  const match = stdout.match(/ProgId\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im);
  return match ? match[1].trim() : null;
}

/**
 * Resolve a ProgId to the command line Windows would run for it.
 * Checks HKCU first (per-user registrations win), then HKLM.
 */
async function readProgIdCommand(progId) {
  for (const root of ['HKCU\\Software\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
    const stdout = await regQuery([`${root}\\${progId}\\shell\\open\\command`, '/ve']);
    if (stdout) {
      const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im);
      if (match) return match[1].trim();
    }
  }
  return null;
}

/**
 * Is FATE the current handler for `.md`?
 *
 * Deliberately does NOT just compare the ProgId string against a constant. Our ProgId is the
 * generic "Markdown Document", which another application could plausibly register — a name match
 * alone would report a false positive. Instead the ProgId is resolved to its open command and that
 * command is checked against this process's own executable. That answers the real question
 * ("would double-clicking a .md file launch *me*?") rather than a proxy for it.
 *
 * In development `process.execPath` is electron.exe, so the comparison falls back to the ProgId
 * hint — there is no packaged exe to match against yet.
 *
 * Returns `{ supported, isDefault, currentProgId, currentCommand }`. `supported: false` off Windows
 * so the renderer hides the control rather than offering something that cannot work.
 */
async function getDefaultAppStatus() {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false, currentProgId: null, currentCommand: null };
  }

  const progId = await readUserChoiceProgId('.md');
  if (!progId) {
    return { supported: true, isDefault: false, currentProgId: null, currentCommand: null };
  }

  const command = await readProgIdCommand(progId);
  let isDefault = false;

  if (command) {
    const ourExe = path.basename(process.execPath).toLowerCase();
    const cmd = command.toLowerCase();
    isDefault = isDev
      // Dev builds run through electron.exe, so matching on the exe name is meaningless here.
      ? progId === MD_PROG_ID_HINT
      // Match on the full path when we can, falling back to the executable name. Both are checked
      // because a per-user install and a per-machine install have different directories but the
      // same exe name.
      : cmd.includes(process.execPath.toLowerCase()) || cmd.includes(ourExe);
  }
  // No resolvable command => NOT default, regardless of what the ProgId is called.
  //
  // This used to fall back to `progId === MD_PROG_ID_HINT`, and that fallback was wrong in exactly
  // the case that matters. A broken install could leave UserChoice still naming "Markdown Document"
  // while the ProgId's command key had been deleted — so Windows fell back to another handler, but
  // FATE cheerfully reported "FATE currently opens .md files". A ProgId with nothing to run is not
  // a default; if the command cannot be resolved, the honest answer is no.

  return { supported: true, isDefault, currentProgId: progId, currentCommand: command };
}

/**
 * Open the Windows UI where the user can review or change the `.md` handler.
 *
 * ── Why this is not just a registry write ─────────────────────────────────────────────────────
 * Since Windows 10 the `UserChoice` key carries a per-user hash (visible in the registry as a
 * `Hash` value beside `ProgId`). Windows validates it, and any application that writes the key
 * itself is detected and reset — deliberately, so apps cannot silently hijack a file type. The
 * final confirmation has to come from a Windows-owned UI.
 *
 * ── Why NOT `rundll32 shell32.dll,OpenAs_RunDLL` ──────────────────────────────────────────────
 * 1.8.0 and 1.8.1 shelled out to that, on the theory that its "How do you want to open this file?"
 * dialog carries an "Always use this app" checkbox. On Windows 11 it does not — the only button is
 * **"Just once"**, so it can never actually set a default there. It merely looked like it worked.
 *
 * Worse, it is not even reliable as a picker: Windows suppresses the dialog entirely once the
 * extension has a confirmed `UserChoice`. So the moment FATE genuinely became the default, the
 * button silently did nothing at all — invoked correctly, valid file, rundll32 present, no dialog.
 * A control whose behaviour inverts once it succeeds is the wrong control.
 *
 * ── What this does instead ────────────────────────────────────────────────────────────────────
 * Deep-links into Settings, which always opens something and is the only surface that can actually
 * change a default on Windows 11. `registeredAppUser` jumps straight to FATE's own page — that works
 * because the installer now registers FATE under HKLM\SOFTWARE\RegisteredApplications with a
 * Capabilities key (see build/installer.nsh). Without that registration Windows ignores the
 * parameter, which is why earlier versions dumped the user on the full alphabetical list; the plain
 * page is kept as the fallback for exactly that case.
 */
async function requestDefaultAppAssociation() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };

  const candidates = [
    /*
     * FATE's own page in Default apps. The parameter matters: `registeredAppMachine` is for apps
     * registered under HKLM\SOFTWARE\RegisteredApplications (which is where the perMachine
     * installer writes ours) — `registeredAppUser` is for HKCU registrations (which the runtime
     * self-heal writes). 1.10.0 passed only the User variant while the registration was
     * Machine-only, which is why the deep link dumped users on the full alphabetical list.
     * Both are tried; Windows ignores a parameter that doesn't match and just opens the list.
     */
    `ms-settings:defaultapps?registeredAppMachine=${encodeURIComponent(APP_TITLE)}`,
    `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_TITLE)}`,
    // Fallback: the Default apps list. The user searches the type themselves.
    'ms-settings:defaultapps'
  ];

  for (const uri of candidates) {
    try {
      await shell.openExternal(uri);
      return { ok: true, via: uri.includes('?') ? 'app-page' : 'settings-list' };
    } catch {
      /* try the next one */
    }
  }

  // Never fail silently — the renderer surfaces this in the status bar.
  return { ok: false, error: 'Could not open Windows Settings' };
}

/**
 * Run a PowerShell script and resolve its stdout.
 *
 * Via a temp `.ps1` and `-File`, NOT `-Command` with an inline string: the association scripts
 * below need `Add-Type -MemberDefinition` here-strings, and a here-string's closing `'@` has to
 * start at column 0 — which survives a file and does not survive being flattened into one argv
 * element. `-ExecutionPolicy Bypass` is required for the same reason (a `.ps1` is subject to
 * policy where `-Command` is not).
 *
 * `-WindowStyle Hidden` is belt to `windowsHide`'s braces. windowsHide alone is documented to be
 * enough, but a console window still flashes on some machines when the child is spawned from a
 * GUI process — which is the most likely cause of the "a PowerShell window blinks when I
 * double-click a .ps1" report, since the launch path runs one of these.
 */
let psScriptSeq = 0;
function runPowerShell(script, timeout = 60000) {
  return new Promise((resolve) => {
    const file = path.join(app.getPath('temp'), `fate-ps-${process.pid}-${psScriptSeq++}.ps1`);
    try {
      fs.writeFileSync(file, script, 'utf-8');
    } catch (e) {
      resolve({ ok: false, error: e.message, stdout: '' });
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, timeout },
      (err, stdout) => {
        try {
          fs.unlinkSync(file);
        } catch {
          /* temp dir cleanup will get it */
        }
        resolve({ ok: !err, error: err?.message, stdout: (stdout || '').trim() });
      }
    );
  });
}

/**
 * Shared PowerShell prelude: ask the SHELL what a file type opens with, rather than inferring it
 * from the registry.
 *
 * ── Why this replaced the registry heuristic in 1.12.0 ────────────────────────────────────────
 * The old counter walked the registry and applied the rules everyone believes Explorer uses:
 * UserChoice, else the `.ext` class default, else a sole OpenWithProgids registrant. Measured
 * against a real machine, rule 2 is simply FALSE on Windows 11 — a class default written by an
 * application does not make it the handler. Worse, writing one SUPPRESSES rule 3, which does
 * work. So the old "claim" feature took 41 types that Explorer was happy to give FATE and left
 * them with no handler at all, while the counter reported them as won (68/86 against a true 29).
 *
 * `AssocQueryString(ASSOCSTR_EXECUTABLE, verb 'open')` is the API Explorer itself resolves through,
 * so there is nothing left to get wrong: it returns the exe that would actually launch, and
 * `OpenWith.exe` (the "How do you want to open this file?" picker) is the no-handler sentinel.
 *
 * Costs an `Add-Type` compile (~1s) on first use, which is why callers are on-demand only.
 */
const ASSOC_PRELUDE = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace FATE -Name Shell -MemberDefinition @'
[DllImport("shlwapi.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern uint AssocQueryString(int flags, int str, string pszAssoc, string pszExtra, System.Text.StringBuilder pszOut, ref uint pcchOut);
[DllImport("shell32.dll")]
public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
function Get-Handler([string] $dotExt) {
  $sb = New-Object System.Text.StringBuilder 2048
  $n = [uint32] 2048
  # 2 = ASSOCSTR_EXECUTABLE. The 'open' verb is required; without it the call returns
  # ERROR_NO_ASSOCIATION even for types that plainly have a handler.
  $rc = [FATE.Shell]::AssocQueryString(0, 2, $dotExt, 'open', $sb, [ref] $n)
  if ($rc -ne 0) { return '' }
  return $sb.ToString()
}
function Test-Ours([string] $progId) {
  if (-not $progId) { return $false }
  return ($progId -eq 'Markdown Document') -or ($progId -like 'FATE.*')
}
`;

/** SHCNE_ASSOCCHANGED — tell Explorer the association map moved so icons and menus catch up. */
const ASSOC_NOTIFY_PS = `[FATE.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)`;

/**
 * Undo the damage 1.10/1.11 did, and keep `.bat`/`.cmd` out of FATE's hands. Runs on every
 * packaged launch (and on demand from Settings → Windows).
 *
 * Two repairs, both deliberately conservative — a type that currently works is never touched:
 *
 *  1. **The dead class defaults.** For any type that resolves to NOTHING while
 *     `HKCU\Software\Classes\.ext` names a FATE ProgId, that value is removed. It was never doing
 *     anything useful (see ASSOC_PRELUDE) and it actively blocks the sole-registrant fallback, so
 *     removing it can only improve the type: it either starts opening with FATE or stays unowned.
 *
 *  2. **`.bat` / `.cmd`.** Every trace of FATE is removed: the Open With entry (the thing that
 *     actually breaks these types — see PROTECTED_EXTENSIONS), the ProgId, the Capabilities entry,
 *     and any FATE `UserChoice`. Deleting a UserChoice is allowed where writing one is not — its
 *     ACL denies SetValue, not Delete, which is how Windows itself resets a type.
 *
 *     LIMIT: this reaches HKCU only, because the app runs unelevated. The 1.11.5 installer wrote
 *     the same entries to HKLM, and those keep the type broken until they are gone. Removing them
 *     needs elevation, so it happens in the installer (RestoreCommandProcessorType in
 *     build/installer.nsh) — upgrading to 1.12.0 is what completes the repair on a machine that
 *     had 1.11.5 installed per-machine.
 */
async function repairAssociations() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };

  const exe = process.execPath.replace(/'/g, "''");
  const list = (arr) => arr.map((e) => `'${e}'`).join(',');
  /*
   * Written into the PowerShell source verbatim, so single backslashes here. Two spellings on
   * purpose: the PowerShell registry PROVIDER needs the drive colon (`HKCU:\…`), reg.exe rejects
   * it and wants the bare hive name (`HKCU\…`).
   */
  const FILE_EXTS_PS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts';
  const FILE_EXTS_REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts';

  const script = `${ASSOC_PRELUDE}
$exe = '${exe}'
$exeName = [System.IO.Path]::GetFileName($exe)
$fixed = @(); $restored = @()

function Test-Unowned([string] $handler) {
  return (-not $handler) -or ($handler -imatch 'OpenWith\\.exe$')
}
function Get-ClassDefault([string] $dotExt) {
  try { return (Get-ItemProperty "HKCU:\\Software\\Classes\\$dotExt" -ErrorAction Stop).'(default)' } catch { return $null }
}
function Remove-UserChoice([string] $dotExt) {
  # NOT reg.exe. It opens the target with KEY_ALL_ACCESS, and UserChoice carries a deny ACE on
  # KEY_SET_VALUE — SDDL (D;;DC;;;<user-sid>) — so that open fails outright with Access Denied.
  # DELETING the key needs only DELETE, which the inherited full-control ACE does grant. Opening
  # the PARENT for write and removing the child through it asks for exactly that and no more.
  # This is the same reset Windows itself performs; only WRITING a UserChoice is protected.
  try {
    $parent = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$dotExt", $true)
    if ($null -eq $parent) { return $false }
    $parent.DeleteSubKey('UserChoice', $false)
    $parent.Close()
    return $true
  } catch { return $false }
}

# ── 1. Class defaults that block the association they were meant to create ──────────────────
foreach ($e in @(${list(ASSOCIABLE_EXTENSIONS)})) {
  $d = ".$e"
  if (-not (Test-Unowned (Get-Handler $d))) { continue }   # working type: leave it alone
  if (Test-Ours (Get-ClassDefault $d)) {
    reg.exe delete "HKCU\\Software\\Classes\\$d" /ve /f > $null 2>&1
    $fixed += $e
  }
}

# ── 2. Give .bat / .cmd back to the command processor, permanently ──────────────────────────
foreach ($e in @(${list(PROTECTED_EXTENSIONS)})) {
  $d = ".$e"
  $uc = $null
  try { $uc = (Get-ItemProperty "${FILE_EXTS_PS}\\$d\\UserChoice" -ErrorAction Stop).ProgId } catch {}
  if ((Test-Ours $uc) -and (Remove-UserChoice $d)) { $restored += $e }
  if (Test-Ours (Get-ClassDefault $d)) { reg.exe delete "HKCU\\Software\\Classes\\$d" /ve /f > $null 2>&1 }
  reg.exe delete "HKCU\\Software\\Classes\\$d\\OpenWithProgids" /v "FATE.$e" /f > $null 2>&1
  reg.exe delete "HKCU\\Software\\Classes\\$d\\OpenWithProgids" /v "FATE.CodeFile" /f > $null 2>&1
  reg.exe delete "${FILE_EXTS_REG}\\$d\\OpenWithProgids" /v "FATE.$e" /f > $null 2>&1
  reg.exe delete "HKCU\\Software\\Classes\\FATE.$e" /f > $null 2>&1
  reg.exe delete "HKCU\\Software\\FATE\\Capabilities\\FileAssociations" /v "$d" /f > $null 2>&1
}

if ($fixed.Count -gt 0 -or $restored.Count -gt 0) { ${ASSOC_NOTIFY_PS} }
@{ fixed = @($fixed); restored = @($restored) } | ConvertTo-Json -Compress
`;

  const { ok, stdout, error } = await runPowerShell(script);
  if (!ok) return { ok: false, error };
  try {
    const parsed = JSON.parse(stdout || '{}');
    const fixed = [].concat(parsed.fixed || []);
    const restored = [].concat(parsed.restored || []);
    // The legacy bookkeeping described writes that never worked; once repaired it means nothing.
    if (fixed.length) store.set('claimedTypes', []);
    return { ok: true, fixed, restored };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Which of FATE's supported file types actually open with FATE.
 *
 * Asks the shell per extension (see ASSOC_PRELUDE) instead of reimplementing Explorer's
 * resolution order, because the registry-heuristic version this replaced was wrong in a way that
 * mattered: it counted FATE's own inert class-default writes as ownership and reported 68/86 on a
 * machine whose true figure was 29.
 *
 * `.bat`/`.cmd` are absent from the total by design — FATE will not take them (PROTECTED_EXTENSIONS).
 *
 * Returns { supported, total, ours, ownedExtensions, unowned, otherApp, repairable } where
 * `unowned` have no handler at all, `otherApp` belong to something else, and `repairable` is the
 * subset of `unowned` still carrying a FATE class default that repairAssociations() can clear.
 */
async function getAssociationCoverage() {
  if (process.platform !== 'win32') {
    return { supported: false, total: 0, ours: 0, ownedExtensions: [], unowned: [], otherApp: [], repairable: [] };
  }

  const exe = process.execPath.replace(/'/g, "''");
  const script = `${ASSOC_PRELUDE}
$exe = '${exe}'
$exeName = [System.IO.Path]::GetFileName($exe)
$owned = @(); $unowned = @(); $other = @(); $repairable = @()

foreach ($e in @(${ASSOCIABLE_EXTENSIONS.map((x) => `'${x}'`).join(',')})) {
  $d = ".$e"
  $h = Get-Handler $d
  if ((-not $h) -or ($h -imatch 'OpenWith\\.exe$')) {
    $unowned += $e
    $cd = $null
    try { $cd = (Get-ItemProperty "HKCU:\\Software\\Classes\\$d" -ErrorAction Stop).'(default)' } catch {}
    if (Test-Ours $cd) { $repairable += $e }
  }
  # Full path first (a per-user and a per-machine install share an exe name), then the name alone.
  elseif (($h -ieq $exe) -or ([System.IO.Path]::GetFileName($h) -ieq $exeName)) { $owned += $e }
  else { $other += $e }
}
@{ owned = @($owned); unowned = @($unowned); other = @($other); repairable = @($repairable) } | ConvertTo-Json -Compress
`;

  const total = ASSOCIABLE_EXTENSIONS.length;
  const { ok, stdout, error } = await runPowerShell(script);
  if (!ok) return { supported: true, total, ours: 0, ownedExtensions: [], unowned: [], otherApp: [], repairable: [], error };
  try {
    const p = JSON.parse(stdout || '{}');
    const ownedExtensions = [].concat(p.owned || []);
    return {
      supported: true,
      total,
      ours: ownedExtensions.length,
      ownedExtensions,
      unowned: [].concat(p.unowned || []),
      otherApp: [].concat(p.other || []),
      repairable: [].concat(p.repairable || []),
      protectedExtensions: PROTECTED_EXTENSIONS
    };
  } catch (e) {
    return { supported: true, total, ours: 0, ownedExtensions: [], unowned: [], otherApp: [], repairable: [], error: e.message };
  }
}

/**
 * Self-healing per-user registration, run at every packaged launch.
 *
 * Discovered the hard way: the installer's HKLM registration can vanish wholesale (an uninstall
 * that precedes a reinstall, upgrade races) and it also goes stale when the install location
 * changes — 1.11.0 moved it. Rather than trusting a write that happened once at install time,
 * the app asserts its own registration under HKCU on launch: ProgId commands pointing at
 * process.execPath (always correct by construction), OpenWithProgids for every code type, and a
 * Capabilities + RegisteredApplications entry so FATE's Default-apps page exists even if HKLM is
 * gone. Per-user keys shadow HKLM, need no elevation, and cost one hidden `reg import` — skipped
 * when a stamp shows the current exe already registered.
 */
function ensureWindowsRegistration() {
  /*
   * app.isPackaged, NOT the NODE_ENV check: a production-mode dev run (`electron .` without
   * NODE_ENV) passes isDev but runs from node_modules' electron.exe — self-healing from there
   * would register ProgIds pointing at the dev toolchain. Only a real installed build registers.
   */
  if (process.platform !== 'win32' || !app.isPackaged || isWindowsStore) return;

  const stampKey = 'registrationStamp';
  // The trailing number is the registration SCHEMA version — bump it whenever the shape of the
  // .reg payload changes, so existing installs re-heal on update even at the same app version.
  const stamp = `${process.execPath}|${app.getVersion()}|4`;
  if (store.get(stampKey) === stamp) return;

  const exe = process.execPath.replace(/\\/g, '\\\\');
  // Per-type document icons ship in resources\fileicons (see scripts/generate-file-icons.mjs).
  const icoFor = (e) =>
    path.join(process.resourcesPath, 'fileicons', `${e}.ico`).replace(/\\/g, '\\\\');
  const lines = [
    'Windows Registry Editor Version 5.00',
    '',
    // Legacy shared ProgId: kept registered (no Open-with listing) so UserChoice entries made on
    // 1.10/1.11 pre-icon installs keep resolving.
    '[HKEY_CURRENT_USER\\Software\\Classes\\FATE.CodeFile]',
    '@="Code File"',
    '"FriendlyTypeName"="Code File (FATE)"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\FATE.CodeFile\\DefaultIcon]',
    `@="${exe},0"`,
    '[HKEY_CURRENT_USER\\Software\\Classes\\FATE.CodeFile\\shell\\open\\command]',
    `@="\\"${exe}\\" \\"%1\\""`,
    `[HKEY_CURRENT_USER\\Software\\Classes\\${MD_PROG_ID_HINT}\\shell\\open\\command]`,
    `@="\\"${exe}\\" \\"%1\\""`,
    '[HKEY_CURRENT_USER\\Software\\FATE\\Capabilities]',
    `"ApplicationName"="${APP_TITLE}"`,
    '"ApplicationDescription"="Formatted Article & Text Editor — a Markdown viewer and code editor for technical documents."',
    '[HKEY_CURRENT_USER\\Software\\FATE\\Capabilities\\FileAssociations]',
    ...MARKDOWN_EXTENSIONS.map((e) => `".${e}"="${MD_PROG_ID_HINT}"`),
    ...ASSOCIABLE_CODE_EXTENSIONS.map((e) => `".${e}"="FATE.${e}"`),
    '[HKEY_CURRENT_USER\\Software\\RegisteredApplications]',
    `"${APP_TITLE}"="Software\\\\FATE\\\\Capabilities"`,
    /*
     * "Edit in FATE" on the right-click menu for EVERY file, like Notepad++'s verb. A classic
     * shell verb lands in Windows 11's "Show more options" tier (the top-level modern menu needs
     * a packaged IExplorerCommand, which an NSIS install cannot ship).
     */
    '[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FATE.edit]',
    '@="Edit in FATE"',
    `"Icon"="${exe},0"`,
    '[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\FATE.edit\\command]',
    `@="\\"${exe}\\" \\"%1\\""`,
    // One ProgId per code type, each with its own gilded extension icon.
    ...ASSOCIABLE_CODE_EXTENSIONS.flatMap((e) => [
      `[HKEY_CURRENT_USER\\Software\\Classes\\FATE.${e}]`,
      `@="${e.toUpperCase()} File (FATE)"`,
      `[HKEY_CURRENT_USER\\Software\\Classes\\FATE.${e}\\DefaultIcon]`,
      `@="${icoFor(e)}"`,
      `[HKEY_CURRENT_USER\\Software\\Classes\\FATE.${e}\\shell\\open\\command]`,
      `@="\\"${exe}\\" \\"%1\\""`,
      `[HKEY_CURRENT_USER\\Software\\Classes\\.${e}\\OpenWithProgids]`,
      `"FATE.${e}"=""`,
      // `=-` deletes the legacy value: one FATE entry in Open With, not two.
      `"${CODE_PROG_ID}"=-`
    ]),
    ''
  ];

  const regFile = path.join(app.getPath('temp'), `fate-registration-${process.pid}.reg`);
  try {
    fs.writeFileSync(regFile, lines.join('\r\n'), 'utf-8');
    execFile('reg', ['import', regFile], { windowsHide: true }, (err) => {
      try {
        fs.unlinkSync(regFile);
      } catch {
        /* temp dir cleanup will get it */
      }
      if (!err) store.set(stampKey, stamp);
      else console.error('Registration self-heal failed:', err.message);
    });
  } catch (e) {
    console.error('Registration self-heal failed:', e.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   PRINTING & PDF EXPORT
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ── Why printing was rebuilt in 1.8.0 ─────────────────────────────────────────────────────────
 * The renderer used to call `window.print()`, which hands off to the Windows print dialog. That
 * dialog renders "This app doesn't support print preview", because Electron ships Chromium *without*
 * the print-preview UI — there is no flag that turns it on. So the user got a printer picker and no
 * idea what would come out.
 *
 * The fix is to stop asking the OS to preview an app window and instead produce the artifact we
 * actually want: `webContents.printToPDF()` renders the document through the `@media print`
 * stylesheet into a real PDF. That PDF can then be
 *   - shown in a preview window (Chromium's built-in PDF viewer, which has genuine page-by-page
 *     preview, zoom, and its own print button), or
 *   - saved straight to disk as an export.
 *
 * Same renderer, same print CSS, both paths — so what you preview is what you get.
 */

/** Page geometry. Margins are in inches, which is what Electron's printToPDF expects. */
const PDF_MARGINS = { top: 0.6, bottom: 0.6, left: 0.65, right: 0.65 };

/**
 * Header and footer for exported/printed pages.
 *
 * Chromium substitutes the `title`, `pageNumber`, `totalPages`, `date` and `url` classes. The
 * templates are deliberately plain and grey — this is page furniture, not a brand surface, and it
 * has to survive being printed in black and white on someone else's printer.
 *
 * The inline font-size is required: Chromium renders these templates at a default of ~1px otherwise.
 */
function headerTemplate(docName) {
  const safe = String(docName || '').replace(/[<>&]/g, '');
  return `<div style="font-family:Georgia,serif;font-size:8px;color:#666;width:100%;padding:0 0.65in;
    display:flex;justify-content:space-between;align-items:center;">
    <span style="letter-spacing:0.08em;text-transform:uppercase;">${safe}</span>
    <span class="date" style="letter-spacing:0.04em;"></span>
  </div>`;
}

const FOOTER_TEMPLATE = `<div style="font-family:Georgia,serif;font-size:8px;color:#888;width:100%;
  padding:0 0.65in;display:flex;justify-content:space-between;align-items:center;">
  <span style="letter-spacing:0.1em;text-transform:uppercase;">FATE</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

/**
 * Render the currently open document to PDF bytes.
 *
 * Options that matter and why:
 *   printBackground: true      — see the long note below. Set true DELIBERATELY.
 *   generateDocumentOutline    — turns the document's headings into real PDF bookmarks. For a
 *                                Markdown viewer whose whole sidebar is a table of contents, this
 *                                is the single highest-value option available.
 *   generateTaggedPDF          — emits structure tags, so screen readers can navigate the export.
 *   preferCSSPageSize: false   — the requested pageSize wins over any `@page` rule, so the Settings
 *                                choice is authoritative.
 *
 * ── Why printBackground is true ───────────────────────────────────────────────────────────────
 * It was false in 1.8.0, on the reasoning that the print stylesheet forces white paper anyway. That
 * reasoning was wrong, and the flag was doing nothing: the stylesheet also sets
 * `print-color-adjust: exact` on the document container, which OVERRIDES printBackground and forces
 * backgrounds to paint regardless. So `false` bought no safety while quietly implying it did — and
 * the dark table-row backgrounds the stylesheet had failed to reset went to paper.
 *
 * Setting it true makes the actual behaviour explicit and leaves the print stylesheet as the single
 * source of truth for print appearance. The stylesheet now zeroes every background inside
 * `.markdown-body` and adds back only light values, so backgrounds printing is wanted: light zebra
 * striping on tables, grey code blocks, a tinted blockquote — all of which aid readability on paper.
 */
async function renderDocumentPdf({ landscape = false, pageSize = 'Letter', docName = 'Document' } = {}) {
  if (!mainWindow) throw new Error('no window to print from');
  return mainWindow.webContents.printToPDF({
    landscape,
    pageSize,
    margins: PDF_MARGINS,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate(docName),
    footerTemplate: FOOTER_TEMPLATE,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
    preferCSSPageSize: false
  });
}

/** Filename-safe version of a document name, for the default export name. */
function safeFileStem(name) {
  return (
    String(name || 'document')
      // Strip the final extension whatever it is — "script.ps1" should export as "script.pdf",
      // not "script.ps1.pdf". (Was markdown-only before code files existed.)
      .replace(/\.[a-z0-9]{1,10}$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'document'
  );
}

let previewWindow = null;

/**
 * Show a print preview.
 *
 * Renders the document to a temp PDF and opens it in a child window with `plugins: true`, which is
 * what enables Chromium's bundled PDF viewer. That viewer provides the real preview the OS dialog
 * could not: actual paginated output, zoom, page navigation, and a print button that prints the
 * *PDF* — so the printer receives exactly what is on screen.
 *
 * A single preview window is reused; printing twice should not litter the desktop with windows.
 */
async function showPrintPreview(docName) {
  const pdf = await renderDocumentPdf({
    docName,
    pageSize: store.get('printPageSize') || 'Letter',
    landscape: !!store.get('printLandscape')
  });

  const file = path.join(app.getPath('temp'), `FATE-preview-${process.pid}.pdf`);
  fs.writeFileSync(file, pdf);

  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.loadURL(pathToFileURL(file).toString());
    previewWindow.focus();
    return { ok: true, reused: true };
  }

  previewWindow = new BrowserWindow({
    width: 940,
    height: 1000,
    minWidth: 480,
    minHeight: 400,
    parent: mainWindow,
    title: `${APP_TITLE} — Print preview`,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      // Required for Chromium's built-in PDF viewer. No preload and no node here — this window
      // only ever displays a PDF we generated ourselves.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // The preview must not become a browser. Nothing in a PDF should be able to navigate it.
  previewWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  previewWindow.on('closed', () => {
    previewWindow = null;
    // Best-effort cleanup; a leftover temp PDF is harmless but there is no reason to keep it.
    try {
      fs.unlinkSync(file);
    } catch {
      /* the viewer may still hold a handle — Windows will reclaim it with the temp dir */
    }
  });

  /*
   * Fallback if the embedded viewer cannot display the PDF.
   *
   * `plugins: true` enables Chromium's bundled PDF viewer, but that depends on the Electron build
   * actually shipping it. If it is missing, `loadURL` on a PDF fails rather than rendering — which
   * would leave the user staring at an empty window with no way forward. Handing the file to the
   * OS default PDF application is a worse preview but an infinitely better failure mode than a
   * blank window.
   */
  previewWindow.webContents.once('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error(`Print preview failed to render PDF (${errorCode}: ${errorDescription}); ` +
                  'falling back to the system PDF handler.');
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
    previewWindow = null;
    shell.openPath(file);
  });

  previewWindow.loadURL(pathToFileURL(file).toString());
  return { ok: true, reused: false };
}

/** Save the document as a PDF the user chooses the location for. */
async function exportPdf(docName) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as PDF',
    defaultPath: `${safeFileStem(docName)}.pdf`,
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const pdf = await renderDocumentPdf({
    docName,
    pageSize: store.get('printPageSize') || 'Letter',
    landscape: !!store.get('printLandscape')
  });
  fs.writeFileSync(filePath, pdf);
  return { ok: true, filePath };
}

const discordClientId = '1513749770005381233';
DiscordRPC.register(discordClientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let rpcReady = false;
const sessionStartTimestamp = new Date();

rpc.on('ready', () => {
  rpcReady = true;
  setDiscordActivity();
});

let currentActivity = {};

/**
 * Publish Rich Presence.
 *
 * ── Filenames are never sent ──────────────────────────────────────────────────────────────────
 * Presence is deliberately generic: "Reading Markdown" or "Idling on the home screen", and nothing
 * else. Up to 1.7.0 there was a "Show filename on Discord" toggle that put the open document's name
 * in the `state` field. It is gone as of 1.8.0 — broadcasting the name of whatever file you have
 * open to everyone on your friends list is a privacy footgun for a documents app, and it is not
 * something anyone needs a setting for.
 *
 * `state` is left unset rather than filled with a generic string, which is exactly the payload the
 * old toggle produced in its OFF position — so presence looks the same as it did for anyone who had
 * it disabled. Everything else about the integration is unchanged.
 *
 * Callers may still pass a `state`; it is ignored on purpose, so a stray call site cannot
 * reintroduce a filename leak.
 */
function setDiscordActivity(activity) {
  if (activity) currentActivity = activity;
  if (!rpcReady) return;

  rpc.setActivity({
    details: currentActivity.details || 'Idling on the home screen',
    startTimestamp: sessionStartTimestamp,
    largeImageKey: 'fate-logo',
    largeImageText: 'FATE',
    instance: false,
  }).catch(console.error);
}

rpc.login({ clientId: discordClientId }).catch(console.error);
protocol.registerSchemesAsPrivileged([
  { scheme: 'fate-local', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true, standard: true, stream: true } }
]);

const isDev = process.env.NODE_ENV === 'development';

/**
 * True when running as the Microsoft Store (AppX) package. Electron sets this for Windows Store
 * builds. It changes two things:
 *   - Updates: electron-updater cannot update an AppX (the Store owns that pipeline). The updater
 *     is never started, and the UI routes "check for updates" to the Store's Downloads & updates
 *     page instead of pretending a check happened.
 *   - Registration: the AppX manifest declares file associations; the registry self-heal below is
 *     skipped (AppX registry writes are virtualised anyway).
 */
const isWindowsStore = process.windowsStore === true;

let mainWindow;

/*
 * ── Multi-tab file tracking ───────────────────────────────────────────────────────────────────
 * Since tabs (1.10.0) any number of files can be open at once, so watching is per-path:
 *
 *   fileWatchers    path → fs.FSWatcher. One live watcher per open tab.
 *   lastSavedByApp  path → content of the last write FATE itself made to that file. Saving from
 *                   the editor fires the same fs.watch 'change' an external edit does; without
 *                   this, every save would bounce back to the renderer as a "file changed on
 *                   disk" event. The watcher compares what it read against this and stays silent
 *                   on a match.
 *
 * Paths are normalized+lowercased as map keys (Windows paths are case-insensitive).
 */
const fileWatchers = new Map();
const lastSavedByApp = new Map();

function watchKey(filePath) {
  return path.normalize(filePath).toLowerCase();
}

/**
 * Whether ANY open tab holds unsaved edits. Mirrored over the 'set-edited' channel on every
 * aggregate transition, so the window-close guard below can ask before discarding them.
 */
let documentEdited = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Below roughly this size the two-column home layout has nowhere left to go and the viewer
    // header starts colliding with itself. The layout is responsive down to here and no further,
    // so the window simply refuses to get smaller rather than degrading into overlap.
    minWidth: 680,
    minHeight: 520,
    title: APP_TITLE,
    backgroundColor: '#070b1a', // avoids a white flash before the renderer paints
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  /*
   * Don't let the window close over unsaved edits.
   *
   * The main process knows only THAT something is dirty (the renderer mirrors an aggregate flag
   * over 'set-edited'); it cannot save, because the buffers live in the renderer's CodeMirror
   * instances. So it vetoes the close once and hands the flow over: the renderer walks its dirty
   * tabs, offering Save / Don't save / Cancel per tab, and calls back on 'confirmed-close'.
   *
   * Before 1.12.0 this was a single "Discard changes and close?" — the only way to keep your work
   * was to cancel, close the dialog, and save by hand.
   *
   * `closeConfirmed` is what lets the second close() through; this handler runs again for it. The
   * timeout is the escape hatch for a renderer that never answers (mid-crash, or a stuck dialog) —
   * without it the window would be unclosable.
   */
  let closeConfirmed = false;
  let closeHandoffTimer = null;
  mainWindow.on('close', (e) => {
    if (closeConfirmed || !documentEdited) return;
    e.preventDefault();
    clearTimeout(closeHandoffTimer);
    closeHandoffTimer = setTimeout(() => {
      closeConfirmed = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }, 60000);
    mainWindow.webContents.send('request-close');
  });

  /** The renderer finished its save-or-discard walk. `proceed: false` means the user cancelled. */
  ipcMain.removeAllListeners('confirmed-close'); // createWindow can run again (macOS 'activate')
  ipcMain.on('confirmed-close', (event, proceed) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return;
    clearTimeout(closeHandoffTimer);
    if (!proceed) return;
    closeConfirmed = true;
    documentEdited = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  // SECURITY: Prevent inner navigation and force external links to open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', async (event, url) => {
    /*
     * The window may only ever navigate to ITSELF (dev server or the packaged dist). The old
     * check allowed any file:// URL, which meant a file dropped outside a drop handler made
     * Chromium NAVIGATE the whole app to that file — the "drag & drop doesn't work" bug. The
     * renderer now preventDefault()s all drops; this is the second line of defence.
     */
    const appOrigin = isDev
      ? 'http://localhost:5173'
      : pathToFileURL(path.join(__dirname, '..', 'dist')).toString();
    if (url.startsWith(appOrigin) || url.startsWith('devtools://')) return;

    event.preventDefault();

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Open Browser'],
        defaultId: 1,
        cancelId: 0,
        title: 'External Link',
        message: `You are about to open an external link:\n${url}\n\nDo you want to continue?`
      });
      if (response === 1) {
        shell.openExternal(url);
      }
    }
    // Anything else (stray file:// navigations included) is silently refused.
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  ipcMain.once('app-ready', () => {
    handleArgs(process.argv);
  });
}

/**
 * Start (or keep) a live-reload watcher for a path. One watcher per open tab; closing the tab
 * removes it via 'close-file'. Separate from openAndWatchFile because Save As needs to adopt a
 * new path WITHOUT re-sending 'open-file' (the renderer already holds the content — reloading it
 * would throw away the cursor and scroll position for no reason).
 */
function watchFile(filePath) {
  const key = watchKey(filePath);
  if (fileWatchers.has(key)) return; // already watching (e.g. the same file reopened)

  const readAndNotify = () => {
    try {
      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      // Our own save just landing back on us — not an external change. See lastSavedByApp.
      if (updatedContent === lastSavedByApp.get(key)) return;
      if (mainWindow) {
        // The path rides along so the renderer can route the update to the right tab.
        mainWindow.webContents.send('file-changed', updatedContent, filePath);
      }
    } catch (err) {
      console.error('Error reading updated file:', err);
    }
  };

  const watcher = fs.watch(filePath, (eventType) => {
    if (eventType === 'change') {
      readAndNotify();
    } else if (eventType === 'rename') {
      /*
       * ATOMIC SAVES arrive as 'rename', not 'change': most editors (VS Code among them) write a
       * temp file and rename it over the original, which replaces the inode this watcher is bound
       * to. Ignoring 'rename' meant edits from such editors never live-reloaded. Re-attach to the
       * new inode (after a beat — the rename may still be mid-flight) and read it.
       */
      setTimeout(() => {
        if (!fileWatchers.has(key)) return; // tab closed in the meantime
        if (!fs.existsSync(filePath)) return; // genuinely deleted/moved away
        try {
          fileWatchers.get(key)?.close();
        } catch {
          /* already dead */
        }
        fileWatchers.delete(key);
        watchFile(filePath);
        readAndNotify();
      }, 100);
    }
  });

  fileWatchers.set(key, watcher);
}

/** Stop watching a path (its tab closed) and drop its save-suppression record. */
function unwatchFile(filePath) {
  if (!filePath) return;
  const key = watchKey(filePath);
  const watcher = fileWatchers.get(key);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(key);
  }
  lastSavedByApp.delete(key);
}

async function openAndWatchFile(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) return;

  try {
    /*
     * Since tabs, opening a file ADDS a tab rather than replacing anything, so there is no
     * unsaved-changes gate here any more. (If the file is already open, the renderer just
     * activates its existing tab.) Dirty buffers are guarded where something is actually
     * discarded: closing a tab, and closing the window.
     */
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      dialog.showErrorBox(
        'File too large',
        `${path.basename(filePath)} is ${(stat.size / 1048576).toFixed(1)} MB. ` +
        `FATE opens text files up to ${MAX_FILE_BYTES / 1048576} MB.`
      );
      return;
    }

    const buffer = fs.readFileSync(filePath);
    if (isProbablyBinary(buffer)) {
      dialog.showErrorBox(
        'Not a text file',
        `${path.basename(filePath)} appears to be a binary file, which FATE cannot display.`
      );
      return;
    }

    const content = buffer.toString('utf-8');
    const name = path.basename(filePath);
    lastSavedByApp.delete(watchKey(filePath)); // fresh read — nothing saved from the app yet
    rememberRecentFile(filePath);

    if (mainWindow) {
      /*
       * `fromRestore` rides along so the renderer can tell a tab the user just asked for from one
       * it is merely reinstating. Session restore replays every path from last time, and each
       * replay used to activate its tab — so double-clicking a file to LAUNCH FATE landed you on
       * whichever restored tab happened to arrive last, not on the file you opened.
       */
      mainWindow.webContents.send('open-file', content, name, filePath, { fromRestore: !!opts.fromRestore });
    }

    watchFile(filePath);
  } catch (e) {
    console.error('Error reading file:', e);
  }
}

function handleArgs(argv) {
  // argv also carries the exe path, the app path in dev, and Chromium switches — hence the
  // "exists AND looks openable" filter rather than the old `endsWith('.md')`.
  const filePath = argv
    .slice(1)
    .find(
      (arg) =>
        !arg.startsWith('-') &&
        isOpenableFile(arg) &&
        fs.existsSync(arg) &&
        fs.statSync(arg).isFile()
    );
  if (filePath) {
    openAndWatchFile(filePath);
  }
}

app.whenReady().then(() => {
  // Register custom protocol for local images
  protocol.handle('fate-local', (request) => {
    let urlPath = request.url.replace(/^fate-local:\/\//, '');
    if (process.platform === 'win32' && urlPath.startsWith('/')) {
      urlPath = urlPath.slice(1);
    }
    urlPath = decodeURIComponent(urlPath);
    return net.fetch(pathToFileURL(urlPath).toString());
  });

  createWindow();
  
  ipcMain.handle('get-app-version', () => app.getVersion());
  
  /**
   * The renderer sends the open document's filename (or null on the home screen) — never a full
   * title string. Composition is owned by composeTitle() so the app name always leads and the
   * taskbar label can never regress to a bare "FATE".
   */
  ipcMain.on('set-title', (event, docName, edited) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setTitle(composeTitle(docName, edited));
  });

  /*
   * The renderer mirrors its dirty flag here on every transition, so the main process can guard
   * window close and file opens without a round trip at decision time. (Asking the renderer
   * "are you dirty?" during the 'close' event would need sync IPC — this inversion avoids that.)
   */
  ipcMain.on('set-edited', (event, edited) => {
    documentEdited = !!edited;
  });

  ipcMain.on('set-discord-activity', (event, activity) => {
    setDiscordActivity(activity);
  });

  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, val) => {
    store.set(key, val);
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All supported files', extensions: [...MARKDOWN_EXTENSIONS, ...CODE_EXTENSIONS] },
        { name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] },
        { name: 'Code files', extensions: [...CODE_EXTENSIONS] },
        // Extensionless files (Dockerfile, .gitignore, …) can only come in through this filter.
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      openAndWatchFile(filePath);
    }
  });

  // ── Saving (code editor) ──────────────────────────────────────────────────────────────────
  ipcMain.handle('save-file', (event, filePath, content) => {
    try {
      if (!filePath) return { ok: false, error: 'No file path to save to' };
      // Record BEFORE writing: fs.watch can fire before writeFileSync returns.
      lastSavedByApp.set(watchKey(filePath), content);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { ok: true };
    } catch (err) {
      lastSavedByApp.delete(watchKey(filePath));
      return { ok: false, error: err.message };
    }
  });

  /**
   * Save As. Writes wherever the user picks, then RETARGETS that tab's watcher and the recents to
   * the new path without re-sending 'open-file' — the renderer already holds the content, and a
   * reload would discard the cursor and scroll position. The renderer updates its own name/path
   * from the response instead. `oldPath` (the tab's previous path, if any) stops being watched.
   */
  ipcMain.handle('save-file-as', async (event, suggestedName, content, oldPath) => {
    let chosenPath = null;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save As',
        defaultPath: suggestedName || 'untitled.txt',
        // Every format FATE opens is offered as a save target — this is what makes "new file"
        // able to become any supported type. "All files" stays last for the odd extension out.
        filters: [
          { name: 'All supported files', extensions: [...MARKDOWN_EXTENSIONS, ...CODE_EXTENSIONS] },
          { name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] },
          { name: 'Code files', extensions: [...CODE_EXTENSIONS] },
          { name: 'All files', extensions: ['*'] }
        ]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      chosenPath = filePath;

      lastSavedByApp.set(watchKey(filePath), content);
      fs.writeFileSync(filePath, content, 'utf-8');
      if (oldPath && watchKey(oldPath) !== watchKey(filePath)) unwatchFile(oldPath);
      rememberRecentFile(filePath);
      watchFile(filePath);
      return { ok: true, filePath, name: path.basename(filePath) };
    } catch (err) {
      if (chosenPath) lastSavedByApp.delete(watchKey(chosenPath));
      return { ok: false, error: err.message };
    }
  });

  /** A tab closed — stop watching its file. */
  ipcMain.on('close-file', (event, filePath) => {
    unwatchFile(filePath);
  });

  /**
   * Native "discard unsaved changes?" confirmation for renderer-initiated closes (Escape, the
   * Back button). Returns true when the user chooses to discard.
   */
  ipcMain.handle('confirm-discard', async (event, message) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: message || 'Discard unsaved changes?',
      detail: 'Your edits have not been saved.'
    });
    return response === 0;
  });

  /**
   * The per-tab prompt of the close walk: Save / Don't save / Cancel.
   *
   * Cancel is both the default and the Escape action deliberately — this dialog appears while the
   * app is on its way out, so the safe answer to a stray keypress is "stop", never "throw the
   * edits away".
   */
  ipcMain.handle('confirm-save-on-close', async (event, docName) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: `Save changes to ${docName || 'this document'} before closing?`,
      detail: "If you don't save, your changes will be lost."
    });
    return ['save', 'discard', 'cancel'][response] || 'cancel';
  });
  
  // ── Recent documents ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('get-recent-files', () => readRecentFiles());

  ipcMain.handle('open-recent-file', (event, filePath, opts) => {
    // Re-check existence here rather than trusting the renderer's cached `exists` flag; the file
    // may have been deleted since the list was rendered.
    if (!filePath || !fs.existsSync(filePath)) {
      // Drop the dead entry so the list self-heals instead of offering it again.
      const remaining = (store.get('recentFiles') || []).filter(
        (e) => path.normalize(e.path || '').toLowerCase() !== path.normalize(filePath || '').toLowerCase()
      );
      store.set('recentFiles', remaining);
      return { ok: false, reason: 'missing' };
    }
    openAndWatchFile(filePath, opts || {});
    return { ok: true };
  });

  ipcMain.handle('clear-recent-files', () => {
    store.set('recentFiles', []);
    return { ok: true };
  });

  // ── Printing & PDF export ─────────────────────────────────────────────────────────────────
  // Both are wrapped so a render failure surfaces in the UI instead of rejecting into the void.
  ipcMain.handle('print-preview', async (event, docName) => {
    try {
      return await showPrintPreview(docName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('export-pdf', async (event, docName) => {
    try {
      return await exportPdf(docName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Default-app association ───────────────────────────────────────────────────────────────
  ipcMain.handle('get-default-app-status', () => getDefaultAppStatus());
  ipcMain.handle('request-default-app', () => requestDefaultAppAssociation());
  ipcMain.handle('get-association-coverage', () => getAssociationCoverage());
  ipcMain.handle('repair-associations', () => repairAssociations());

  /** Build facts the renderer adjusts its UI to (Store builds get Store-owned updates). */
  ipcMain.handle('get-runtime-info', () => ({
    windowsStore: isWindowsStore,
    platform: process.platform
  }));

  /*
   * Font families installed on this machine, for Settings → Fonts. Enumerated once per app run
   * via GDI+ (one hidden PowerShell call, ~300 names) and cached — font installs mid-session are
   * rare enough that a restart picking them up is fine. Purely local: the list never leaves the
   * process, matching the privacy posture.
   */
  let systemFontsCache = null;
  ipcMain.handle('get-system-fonts', () => {
    if (systemFontsCache) return systemFontsCache;
    if (process.platform !== 'win32') return [];
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          // See runPowerShell: -WindowStyle Hidden alongside windowsHide, because this one runs
          // on the launch path and a flash here reads as "FATE ran my script before opening it".
          '-WindowStyle',
          'Hidden',
          '-Command',
          'Add-Type -AssemblyName System.Drawing; ([System.Drawing.Text.InstalledFontCollection]::new()).Families | ForEach-Object { $_.Name } | ConvertTo-Json -Compress'
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve([]);
            return;
          }
          try {
            const names = [].concat(JSON.parse(stdout.trim())).filter((n) => typeof n === 'string' && n);
            systemFontsCache = [...new Set(names)].sort((a, b) => a.localeCompare(b));
            resolve(systemFontsCache);
          } catch {
            resolve([]);
          }
        }
      );
    });
  });

  /*
   * ── Classic context menus (opt-in, Settings → Windows) ─────────────────────────────────────
   * Windows 11's modern right-click menu only surfaces packaged IExplorerCommand handlers at the
   * top level; classic verbs like "Edit in FATE" sit under "Show more options". This well-known
   * per-user tweak (an empty InprocServer32 under this CLSID) makes Explorer always show the full
   * classic menu — where FATE's verb IS top-level. Fully reversible; takes effect when Explorer
   * restarts. FATE only ever creates/deletes this exact key, and only when the user asks.
   */
  const CLASSIC_MENU_CLSID = 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}';

  ipcMain.handle('get-classic-menu', () =>
    new Promise((resolve) => {
      execFile('reg', ['query', `${CLASSIC_MENU_CLSID}\\InprocServer32`, '/ve'], { windowsHide: true }, (err) =>
        resolve(!err)
      );
    })
  );

  ipcMain.handle('set-classic-menu', (event, enabled) =>
    new Promise((resolve) => {
      const args = enabled
        ? ['add', `${CLASSIC_MENU_CLSID}\\InprocServer32`, '/ve', '/d', '', '/f']
        : ['delete', CLASSIC_MENU_CLSID, '/f'];
      execFile('reg', args, { windowsHide: true }, (err) =>
        resolve({ ok: !err, error: err?.message })
      );
    })
  );

  /** Explorer restart, so the classic-menu change applies without a sign-out. */
  ipcMain.handle('restart-explorer', () =>
    new Promise((resolve) => {
      execFile('cmd', ['/c', 'taskkill /f /im explorer.exe & start explorer.exe'], { windowsHide: true }, (err) =>
        resolve({ ok: !err })
      );
    })
  );

  ipcMain.handle('check-for-updates', () => {
    /*
     * Store builds: electron-updater cannot update an AppX — the Store owns that pipeline, and
     * the previous behaviour ("Checking for updates…" followed by silence or an error) looked
     * broken because it was. Route to the Store's own updates page instead.
     */
    if (isWindowsStore) {
      shell.openExternal('ms-windows-store://downloadsandupdates');
      return;
    }
    if (!isDev && store.get('autoUpdatesEnabled')) {
      autoUpdater.checkForUpdates();
    }
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('checking-for-update', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'Checking for updates...', null);
  });
  
  autoUpdater.on('update-available', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-message', `Update v${info.version} available! Downloading...`, null);
  });
  
  autoUpdater.on('update-not-available', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'You are on the latest version.', null);
  });
  
  autoUpdater.on('error', (err) => {
    if(mainWindow) mainWindow.webContents.send('update-message', `Error checking for updates: ${err.message}`, null);
  });
  
  autoUpdater.on('update-downloaded', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'Update downloaded! Ready to install.', 'install');
  });

  if (!isDev && !isWindowsStore) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  ensureWindowsRegistration();

  /*
   * Repair before the user can trip over it, on every launch rather than behind a stamp: the
   * `.bat` hijack it undoes can be re-created at any time from Windows Settings (up to 1.11.5
   * FATE listed .bat on its own Default-apps page), so a once-per-version check would leave a
   * window where batch files silently stop running. Async, off the startup path, and a no-op
   * when there is nothing to fix.
   */
  if (process.platform === 'win32' && app.isPackaged) {
    repairAssociations()
      .then((r) => {
        if (r.restored?.length) console.log('Restored the command processor for:', r.restored.join(', '));
        if (r.fixed?.length) console.log('Cleared dead class defaults for', r.fixed.length, 'types');
      })
      .catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      handleArgs(commandLine)
    }
  })
}
