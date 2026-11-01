# RemoveBG — Ctrl+V au niveau système (SendKeys)
# Lancé par Zen (nsIProcess.runAsync) après écriture de l'image au clipboard.
# Le raccourci part dans la fenêtre foreground : le vrai pipeline OS,
# activation utilisateur incluse — équivalent du Ctrl+V manuel.
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('^v')
