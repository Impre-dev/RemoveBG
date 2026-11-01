#Requires AutoHotkey v2.0
; RemoveBG — Ctrl+V au niveau système (lancé par Zen via nsIProcess).
; Le raccourci part dans la fenêtre foreground : le vrai pipeline OS,
; activation utilisateur incluse — équivalent du Ctrl+V manuel.
Sleep(500)
Send('^v')
