!include LogicLib.nsh
!include FileFunc.nsh

# ── 1.11.0: the product was renamed and rehomed ────────────────────────────────────────────────
#
#   productName   "FATE - Markdown Viewer"  →  "FATE - Formatted Article & Text Editor"
#   install dir   (wherever 1.x lived)      →  $PROGRAMFILES64\VagueDustin Enterprises\FATE
#
# preInit runs before electron-builder reads the remembered InstallLocation, which is exactly the
# window needed to (a) silently remove the old-name install so two FATEs never coexist, and
# (b) seed the remembered location with the new publisher-directory default. Without (b) the
# assisted installer would keep proposing the old directory forever.
#
# The .md association checkbox is GONE (was a custom page here): defaults are managed from the
# app's own Settings → Windows page now, which deep-links into Windows Settings. The installer
# only *registers* capabilities; it never claims a UserChoice — Windows wouldn't honour that
# anyway.

!macro preInit
  SetRegView 64

  ; Read the remembered install location EXPLICITLY from HKLM (perMachine build), falling back to
  ; HKCU. Deliberately not SHCTX: preInit runs before electron-builder has settled it, so SHCTX can
  ; still point at HKCU here — which would silently skip the migration below on a machine that has
  ; the old install recorded in HKLM. `${INSTALL_REGISTRY_KEY}` is keyed off appId, which did NOT
  ; change across the rename, so the pre-rename install is findable at all.
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}

  StrCpy $R2 "0" ; did we just remove a pre-rename install?

  ; Remove the pre-rename install, wherever it is. Its uninstaller cleans its own registry
  ; (including the old "FATE - Markdown Viewer" RegisteredApplications entry). `_?=` makes the
  ; uninstaller run synchronously in place, which also means it cannot delete itself or its
  ; directory — hence the manual Delete/RMDir sweep after.
  ${If} $R0 != ""
    ${If} ${FileExists} "$R0\Uninstall FATE - Markdown Viewer.exe"
      ExecWait '"$R0\Uninstall FATE - Markdown Viewer.exe" /S _?=$R0'
      Delete "$R0\Uninstall FATE - Markdown Viewer.exe"
      RMDir /r "$R0"
      ; The old layout sometimes nested under a "FATE" bucket — remove the parent only if empty.
      ${GetParent} "$R0" $R1
      RMDir "$R1"
      StrCpy $R2 "1"
    ${EndIf}
  ${EndIf}

  ; Seed the default home — the publisher directory, own folder — ONLY when there is nothing to
  ; preserve: a first install, or one whose remembered location we just deleted. Writing this
  ; unconditionally would silently drag a user who chose their own directory back to the default on
  ; every single upgrade (allowToChangeInstallationDirectory is on, so that choice is theirs).
  ${If} $R0 == ""
  ${OrIf} $R2 == "1"
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\VagueDustin Enterprises\FATE"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\VagueDustin Enterprises\FATE"
  ${EndIf}
!macroend

# ── Code-file registration ──────────────────────────────────────────────────────────────────────
#
# Registered POLITELY:
#   * `OpenWithProgids` adds FATE.CodeFile to each extension's "Open with" list without touching
#     anyone's default. For extensions where FATE ends up the ONLY registered handler, Explorer
#     opens them with FATE with no further action — which is why the app's coverage counter counts
#     sole-handler fallbacks as FATE's.
#   * Capabilities\FileAssociations puts every type on FATE's page in Windows Settings.
#
# NOT electron-builder's fileAssociations mechanism for these 83: that would stomp the (default)
# ProgId of extensions owned by other tools. `.md`/`.markdown` keep the electron-builder mechanism.
#
# The extension list mirrors CODE_EXTENSIONS in electron/main.cjs and src/fileKinds.js — the three
# must be edited together. The app also self-heals this registration per-user at launch (see
# ensureWindowsRegistration in electron/main.cjs), so a broken or raced installer state fixes
# itself on first run.

!macro RegisterCodeType EXT DESC
  WriteRegStr SHCTX "Software\Classes\FATE.${EXT}" "" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\FATE.${EXT}\DefaultIcon" "" "$INSTDIR\resources\fileicons\${EXT}.ico"
  WriteRegStr SHCTX "Software\Classes\FATE.${EXT}\shell\open\command" "" '"$INSTDIR\FATE.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "FATE.${EXT}" ""
  ; Migrate the 1.10-era shared ProgId out of Open With (the ProgId itself stays registered so an
  ; existing UserChoice pointing at FATE.CodeFile keeps working — see customInstall).
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "FATE.CodeFile"
  WriteRegStr SHCTX "Software\FATE\Capabilities\FileAssociations" ".${EXT}" "FATE.${EXT}"
!macroend

!macro UnregisterCodeType EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "FATE.${EXT}"
  DeleteRegKey SHCTX "Software\Classes\FATE.${EXT}"
!macroend

!macro customInstall
  # ── Register FATE as a Windows "Registered Application" (new name) ────────────────────────────
  # This is what gives FATE its own page in Settings > Default apps and makes the
  # `ms-settings:defaultapps?registeredAppMachine=…` deep link land there. SHCTX is HKLM
  # (perMachine install).
  WriteRegStr SHCTX "Software\FATE\Capabilities" "ApplicationName" "FATE - Formatted Article & Text Editor"
  WriteRegStr SHCTX "Software\FATE\Capabilities" "ApplicationDescription" \
    "Formatted Article & Text Editor — a Markdown viewer and code editor for technical documents."
  WriteRegStr SHCTX "Software\FATE\Capabilities\FileAssociations" ".md" "Markdown Document"
  WriteRegStr SHCTX "Software\FATE\Capabilities\FileAssociations" ".markdown" "Markdown Document"
  WriteRegStr SHCTX "Software\FATE\Capabilities\FileAssociations" ".txt" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\.txt\OpenWithProgids" "Markdown Document" ""
  WriteRegStr SHCTX "Software\RegisteredApplications" "FATE - Formatted Article & Text Editor" "Software\FATE\Capabilities"

  # ── "Edit in FATE" on the right-click menu for every file (like Notepad++'s verb) ────────────
  # Classic shell verb: appears in Windows 11's "Show more options" tier and in the full legacy
  # menu. The runtime self-heal writes the same verb under HKCU.
  WriteRegStr SHCTX "Software\Classes\*\shell\FATE.edit" "" "Edit in FATE"
  WriteRegStr SHCTX "Software\Classes\*\shell\FATE.edit" "Icon" "$INSTDIR\FATE.exe,0"
  WriteRegStr SHCTX "Software\Classes\*\shell\FATE.edit\command" "" '"$INSTDIR\FATE.exe" "%1"'

  # ── The FATE.CodeFile ProgId ──────────────────────────────────────────────────────────────────
  WriteRegStr SHCTX "Software\Classes\FATE.CodeFile" "" "Code File"
  WriteRegStr SHCTX "Software\Classes\FATE.CodeFile" "FriendlyTypeName" "Code File (FATE)"
  WriteRegStr SHCTX "Software\Classes\FATE.CodeFile\DefaultIcon" "" "$INSTDIR\FATE.exe,0"
  WriteRegStr SHCTX "Software\Classes\FATE.CodeFile\shell\open\command" "" '"$INSTDIR\FATE.exe" "%1"'

  !insertmacro RegisterCodeType "js" "JS File (FATE)"
  !insertmacro RegisterCodeType "mjs" "MJS File (FATE)"
  !insertmacro RegisterCodeType "cjs" "CJS File (FATE)"
  !insertmacro RegisterCodeType "jsx" "JSX File (FATE)"
  !insertmacro RegisterCodeType "ts" "TS File (FATE)"
  !insertmacro RegisterCodeType "tsx" "TSX File (FATE)"
  !insertmacro RegisterCodeType "json" "JSON File (FATE)"
  !insertmacro RegisterCodeType "jsonc" "JSONC File (FATE)"
  !insertmacro RegisterCodeType "html" "HTML File (FATE)"
  !insertmacro RegisterCodeType "htm" "HTM File (FATE)"
  !insertmacro RegisterCodeType "xhtml" "XHTML File (FATE)"
  !insertmacro RegisterCodeType "css" "CSS File (FATE)"
  !insertmacro RegisterCodeType "scss" "SCSS File (FATE)"
  !insertmacro RegisterCodeType "sass" "SASS File (FATE)"
  !insertmacro RegisterCodeType "less" "LESS File (FATE)"
  !insertmacro RegisterCodeType "ps1" "PS1 File (FATE)"
  !insertmacro RegisterCodeType "psm1" "PSM1 File (FATE)"
  !insertmacro RegisterCodeType "psd1" "PSD1 File (FATE)"
  !insertmacro RegisterCodeType "py" "PY File (FATE)"
  !insertmacro RegisterCodeType "pyw" "PYW File (FATE)"
  !insertmacro RegisterCodeType "rb" "RB File (FATE)"
  !insertmacro RegisterCodeType "php" "PHP File (FATE)"
  !insertmacro RegisterCodeType "sql" "SQL File (FATE)"
  !insertmacro RegisterCodeType "xml" "XML File (FATE)"
  !insertmacro RegisterCodeType "xsl" "XSL File (FATE)"
  !insertmacro RegisterCodeType "svg" "SVG File (FATE)"
  !insertmacro RegisterCodeType "yaml" "YAML File (FATE)"
  !insertmacro RegisterCodeType "yml" "YML File (FATE)"
  !insertmacro RegisterCodeType "toml" "TOML File (FATE)"
  !insertmacro RegisterCodeType "ini" "INI File (FATE)"
  !insertmacro RegisterCodeType "cfg" "CFG File (FATE)"
  !insertmacro RegisterCodeType "conf" "CONF File (FATE)"
  !insertmacro RegisterCodeType "sh" "SH File (FATE)"
  !insertmacro RegisterCodeType "bash" "BASH File (FATE)"
  !insertmacro RegisterCodeType "zsh" "ZSH File (FATE)"
  !insertmacro RegisterCodeType "bat" "BAT File (FATE)"
  !insertmacro RegisterCodeType "cmd" "CMD File (FATE)"
  !insertmacro RegisterCodeType "c" "C File (FATE)"
  !insertmacro RegisterCodeType "h" "H File (FATE)"
  !insertmacro RegisterCodeType "cpp" "CPP File (FATE)"
  !insertmacro RegisterCodeType "hpp" "HPP File (FATE)"
  !insertmacro RegisterCodeType "cc" "CC File (FATE)"
  !insertmacro RegisterCodeType "cxx" "CXX File (FATE)"
  !insertmacro RegisterCodeType "hxx" "HXX File (FATE)"
  !insertmacro RegisterCodeType "cs" "CS File (FATE)"
  !insertmacro RegisterCodeType "java" "JAVA File (FATE)"
  !insertmacro RegisterCodeType "go" "GO File (FATE)"
  !insertmacro RegisterCodeType "rs" "RS File (FATE)"
  !insertmacro RegisterCodeType "swift" "SWIFT File (FATE)"
  !insertmacro RegisterCodeType "kt" "KT File (FATE)"
  !insertmacro RegisterCodeType "kts" "KTS File (FATE)"
  !insertmacro RegisterCodeType "dart" "DART File (FATE)"
  !insertmacro RegisterCodeType "lua" "LUA File (FATE)"
  !insertmacro RegisterCodeType "r" "R File (FATE)"
  !insertmacro RegisterCodeType "pl" "PL File (FATE)"
  !insertmacro RegisterCodeType "pm" "PM File (FATE)"
  !insertmacro RegisterCodeType "scala" "SCALA File (FATE)"
  !insertmacro RegisterCodeType "groovy" "GROOVY File (FATE)"
  !insertmacro RegisterCodeType "gradle" "GRADLE File (FATE)"
  !insertmacro RegisterCodeType "vue" "VUE File (FATE)"
  !insertmacro RegisterCodeType "svelte" "SVELTE File (FATE)"
  !insertmacro RegisterCodeType "tex" "TEX File (FATE)"
  !insertmacro RegisterCodeType "diff" "DIFF File (FATE)"
  !insertmacro RegisterCodeType "patch" "PATCH File (FATE)"
  !insertmacro RegisterCodeType "log" "LOG File (FATE)"
  !insertmacro RegisterCodeType "env" "ENV File (FATE)"
  !insertmacro RegisterCodeType "proto" "PROTO File (FATE)"
  !insertmacro RegisterCodeType "graphql" "GRAPHQL File (FATE)"
  !insertmacro RegisterCodeType "gql" "GQL File (FATE)"
  !insertmacro RegisterCodeType "vb" "VB File (FATE)"
  !insertmacro RegisterCodeType "fs" "FS File (FATE)"
  !insertmacro RegisterCodeType "fsx" "FSX File (FATE)"
  !insertmacro RegisterCodeType "erl" "ERL File (FATE)"
  !insertmacro RegisterCodeType "ex" "EX File (FATE)"
  !insertmacro RegisterCodeType "exs" "EXS File (FATE)"
  !insertmacro RegisterCodeType "hs" "HS File (FATE)"
  !insertmacro RegisterCodeType "clj" "CLJ File (FATE)"
  !insertmacro RegisterCodeType "cljs" "CLJS File (FATE)"
  !insertmacro RegisterCodeType "edn" "EDN File (FATE)"
  !insertmacro RegisterCodeType "nim" "NIM File (FATE)"
  !insertmacro RegisterCodeType "zig" "ZIG File (FATE)"
  !insertmacro RegisterCodeType "jl" "JL File (FATE)"
  !insertmacro RegisterCodeType "asm" "ASM File (FATE)"
!macroend

!macro customUnInstall
  # Remove the Registered Application entry (and the pre-rename one, if a stale copy survived).
  DeleteRegValue SHCTX "Software\RegisteredApplications" "FATE - Formatted Article & Text Editor"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "FATE - Markdown Viewer"
  DeleteRegKey SHCTX "Software\FATE\Capabilities\FileAssociations"
  DeleteRegKey SHCTX "Software\FATE\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\FATE"

  # Drop the code-file ProgId, the context-menu verb, and every Open-with reference to them.
  DeleteRegKey SHCTX "Software\Classes\FATE.CodeFile"
  DeleteRegKey SHCTX "Software\Classes\*\shell\FATE.edit"
  DeleteRegKey HKCU "Software\Classes\*\shell\FATE.edit"
  DeleteRegValue SHCTX "Software\Classes\.txt\OpenWithProgids" "Markdown Document"

  # Best-effort cleanup of the current user's self-healed registration (see main.cjs).
  DeleteRegKey HKCU "Software\Classes\FATE.CodeFile"
  DeleteRegValue HKCU "Software\RegisteredApplications" "FATE - Formatted Article & Text Editor"
  DeleteRegKey HKCU "Software\FATE\Capabilities\FileAssociations"
  DeleteRegKey HKCU "Software\FATE\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\FATE"

  # If we were installed inside the publisher directory, remove it too — but only if empty
  # (other VagueDustin Enterprises software may live beside us).
  ${GetParent} "$INSTDIR" $R0
  RMDir "$R0"

  # Per-type ProgIds and their Open-with entries. Generated block — the extension list mirrors
  # CODE_EXTENSIONS in electron/main.cjs and src/fileKinds.js.
  !insertmacro UnregisterCodeType "js"
  !insertmacro UnregisterCodeType "mjs"
  !insertmacro UnregisterCodeType "cjs"
  !insertmacro UnregisterCodeType "jsx"
  !insertmacro UnregisterCodeType "ts"
  !insertmacro UnregisterCodeType "tsx"
  !insertmacro UnregisterCodeType "json"
  !insertmacro UnregisterCodeType "jsonc"
  !insertmacro UnregisterCodeType "html"
  !insertmacro UnregisterCodeType "htm"
  !insertmacro UnregisterCodeType "xhtml"
  !insertmacro UnregisterCodeType "css"
  !insertmacro UnregisterCodeType "scss"
  !insertmacro UnregisterCodeType "sass"
  !insertmacro UnregisterCodeType "less"
  !insertmacro UnregisterCodeType "ps1"
  !insertmacro UnregisterCodeType "psm1"
  !insertmacro UnregisterCodeType "psd1"
  !insertmacro UnregisterCodeType "py"
  !insertmacro UnregisterCodeType "pyw"
  !insertmacro UnregisterCodeType "rb"
  !insertmacro UnregisterCodeType "php"
  !insertmacro UnregisterCodeType "sql"
  !insertmacro UnregisterCodeType "xml"
  !insertmacro UnregisterCodeType "xsl"
  !insertmacro UnregisterCodeType "svg"
  !insertmacro UnregisterCodeType "yaml"
  !insertmacro UnregisterCodeType "yml"
  !insertmacro UnregisterCodeType "toml"
  !insertmacro UnregisterCodeType "ini"
  !insertmacro UnregisterCodeType "cfg"
  !insertmacro UnregisterCodeType "conf"
  !insertmacro UnregisterCodeType "sh"
  !insertmacro UnregisterCodeType "bash"
  !insertmacro UnregisterCodeType "zsh"
  !insertmacro UnregisterCodeType "bat"
  !insertmacro UnregisterCodeType "cmd"
  !insertmacro UnregisterCodeType "c"
  !insertmacro UnregisterCodeType "h"
  !insertmacro UnregisterCodeType "cpp"
  !insertmacro UnregisterCodeType "hpp"
  !insertmacro UnregisterCodeType "cc"
  !insertmacro UnregisterCodeType "cxx"
  !insertmacro UnregisterCodeType "hxx"
  !insertmacro UnregisterCodeType "cs"
  !insertmacro UnregisterCodeType "java"
  !insertmacro UnregisterCodeType "go"
  !insertmacro UnregisterCodeType "rs"
  !insertmacro UnregisterCodeType "swift"
  !insertmacro UnregisterCodeType "kt"
  !insertmacro UnregisterCodeType "kts"
  !insertmacro UnregisterCodeType "dart"
  !insertmacro UnregisterCodeType "lua"
  !insertmacro UnregisterCodeType "r"
  !insertmacro UnregisterCodeType "pl"
  !insertmacro UnregisterCodeType "pm"
  !insertmacro UnregisterCodeType "scala"
  !insertmacro UnregisterCodeType "groovy"
  !insertmacro UnregisterCodeType "gradle"
  !insertmacro UnregisterCodeType "vue"
  !insertmacro UnregisterCodeType "svelte"
  !insertmacro UnregisterCodeType "tex"
  !insertmacro UnregisterCodeType "diff"
  !insertmacro UnregisterCodeType "patch"
  !insertmacro UnregisterCodeType "log"
  !insertmacro UnregisterCodeType "env"
  !insertmacro UnregisterCodeType "proto"
  !insertmacro UnregisterCodeType "graphql"
  !insertmacro UnregisterCodeType "gql"
  !insertmacro UnregisterCodeType "vb"
  !insertmacro UnregisterCodeType "fs"
  !insertmacro UnregisterCodeType "fsx"
  !insertmacro UnregisterCodeType "erl"
  !insertmacro UnregisterCodeType "ex"
  !insertmacro UnregisterCodeType "exs"
  !insertmacro UnregisterCodeType "hs"
  !insertmacro UnregisterCodeType "clj"
  !insertmacro UnregisterCodeType "cljs"
  !insertmacro UnregisterCodeType "edn"
  !insertmacro UnregisterCodeType "nim"
  !insertmacro UnregisterCodeType "zig"
  !insertmacro UnregisterCodeType "jl"
  !insertmacro UnregisterCodeType "asm"
!macroend
