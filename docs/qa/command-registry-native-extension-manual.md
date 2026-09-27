# Command Registry + Native Extension — manual QA gate

Branch: `feat/magibar-command-native-extensions`  
PRD: 0008  
Task: 0045

## Automated layers to run locally

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm e2e:launcher`
4. `node scripts/validate-nd-extension.mjs --builtins`
5. `node scripts/validate-nd-extension.mjs examples/nd-extension-wallpaper`

The repository currently keeps GitHub Actions parked; do not translate static review into a green execution claim.

## Windows P0 manual

- Open the global launcher in Personal context.
- Verify **Choose wallpaper** appears under Extensions.
- Run it and cancel the file picker: no wallpaper change and no error.
- Run it again and choose a PNG/JPEG/WebP/BMP.
- Verify the desktop wallpaper changes.
- Switch the launcher to a Company or Project context and verify the command is absent.
- Verify Settings → Extensions shows Wallpaper Manager as a Personal extension with `os.wallpaper.write`.
- If invoking the capability through an agent path, verify approval is requested before the OS effect.

## Regression checks

- Core launcher actions still run after the source-registry refactor.
- Recent project and company switching still work.
- Daily Essentials extension commands still appear.
- General/Coding switching does not alter extension activation or running company work.
- A manifest that declares `os.wallpaper.chooseAndSet` for Company/Project is rejected by validation.

## Platform notes

- macOS uses `osascript`; perform a real desktop check before claiming support.
- Linux targets GNOME `gsettings`; other desktop environments are not claimed by this slice.
