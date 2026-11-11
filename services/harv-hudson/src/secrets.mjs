import { spawn } from 'node:child_process';

// Windows DPAPI, bound to the signed-in Windows account. Secrets travel on stdin,
// never on the process command line or in log messages.
export class WindowsVault {
  async protect(value) { return this.#run('protect', value); }
  async unprotect(value) { return this.#run('unprotect', value); }
  async #run(mode, value) {
    if (process.platform !== 'win32') throw new Error('Esta versión usa Windows DPAPI; requiere Windows.');
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); ` + (mode === 'protect'
      ? `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
      : `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`);
    return new Promise((resolve,reject) => {
      const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
      let output = ''; let settled = false;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(output.trim()); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('DPAPI no respondió.')); }, 15_000);
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.resume();
      child.on('error', () => finish(new Error('No se pudo ejecutar Windows DPAPI.')));
      child.on('close', code => finish(code === 0 ? null : new Error('No se pudo abrir/proteger la credencial de Windows.')));
      child.stdin.on('error', () => {}); child.stdin.end(value);
    });
  }
}
