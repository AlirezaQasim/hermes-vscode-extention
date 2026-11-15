param(
    [string]$OutputFile = ""
)

if (-not $OutputFile) {
    $OutputFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "hermes_voice_" + [System.Guid]::NewGuid().ToString("N") + ".wav")
}

$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinSoundRecorder {
    [DllImport("winmm.dll", EntryPoint="mciSendStringA", ExactSpelling=true, CharSet=CharSet.Ansi)]
    public static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
}
"@
Add-Type -TypeDefinition $source

$sb = New-Object System.Text.StringBuilder 256

# Open & Record
[WinSoundRecorder]::mciSendString("open new type waveaudio alias recsound", $sb, 256, [IntPtr]::Zero) | Out-Null
[WinSoundRecorder]::mciSendString("record recsound", $sb, 256, [IntPtr]::Zero) | Out-Null

Write-Output "HERMES_RECORDING_STARTED"
[Console]::Out.Flush()

# Wait for STOP command on stdin or EOF
while ($line = [Console]::ReadLine()) {
    if ($null -ne $line -and $line.Trim() -eq "STOP") {
        break
    }
}

# Save and close
[WinSoundRecorder]::mciSendString("save recsound `"$OutputFile`"", $sb, 256, [IntPtr]::Zero) | Out-Null
[WinSoundRecorder]::mciSendString("close recsound", $sb, 256, [IntPtr]::Zero) | Out-Null

if (Test-Path $OutputFile) {
    Write-Output "HERMES_RECORDING_SAVED:$OutputFile"
} else {
    Write-Error "HERMES_RECORDING_FAILED"
}
