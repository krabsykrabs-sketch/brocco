/**
 * Dictionary partial — "auth" area. Merged into src/lib/dict.ts.
 * Every key needs all three languages; scripts/check-i18n.ts enforces it.
 *
 * Also carries the logged-out surfaces that share the auth look: the More
 * page's legal link, and the whole /legal page (imprint + privacy policy).
 * Long legal paragraphs are one key each; a paragraph that wraps a link is
 * split into before/link/after so the link can sit inside the sentence.
 */
export const en = {
  // Shared auth chrome
  "auth.tagline": "Run like a broccoli.",
  "auth.mascotAlt": "Brocco, running",
  "auth.emailPlaceholder": "you@example.com",

  // Login
  "auth.passwordPlaceholder": "Enter password",
  "auth.loginFailed": "Login failed",
  "auth.haveInvite": "Have an invite code?",

  // Signup
  "auth.joinTitle": "Join brocco.run",
  "auth.inviteNeeded": "You need an invite code to sign up.",
  "auth.accessCodePlaceholder": "The code you got from your inviter",
  "auth.namePlaceholder": "Your name",
  "auth.newPasswordPlaceholder": "At least 8 characters",
  "auth.creatingAccount": "Creating account…",
  "auth.signupFailed": "Signup failed",
  "auth.alreadyHaveAccount": "Already have an account?",

  // Forgot password
  "auth.forgotIntro": "Enter your account email and we'll send you a reset link.",
  "auth.forgotSent": "If that address has an account, a reset link is on its way. Check your inbox (and the spam folder).",
  "auth.sending": "Sending…",
  "auth.sendResetLink": "Send reset link",
  "auth.backToLogin": "Back to login",

  // Reset password
  "auth.chooseNewPassword": "Choose a new password",
  "auth.newPassword": "New password",
  "auth.repeatNewPassword": "Repeat new password",
  "auth.setNewPassword": "Set new password",
  "auth.passwordsMismatch": "Passwords don't match",
  "auth.minChars": "Minimum 8 characters",
  "auth.sameAgain": "Same again",
  "auth.resetFailed": "Reset failed",
  "auth.resetLinkIncomplete": "This reset link is incomplete.",
  "auth.requestNewLink": "Request a new one",
  "auth.passwordUpdated": "Password updated. Taking you to the login…",

  // More page
  "more.legalLink": "Imprint & Privacy",

  // Legal page
  "legal.back": "Back",
  "legal.title": "Legal",
  "legal.imprintTitle": "Imprint (Impressum)",
  "legal.nameLabel": "Name:",
  "legal.emailLabel": "Email:",
  "legal.nonCommercial": "This is a non-commercial, personal project.",
  "legal.privacyTitle": "Privacy Policy",
  "legal.storeTitle": "What we store",
  "legal.storeAuth": "Your email, name, and password hash for authentication",
  "legal.storeStrava": "If you connect Strava: your activity data (distance, pace, heart rate, splits, etc.) and OAuth tokens (encrypted at rest)",
  "legal.storeChat": "Chat messages and coaching notes from your conversations with Brocco",
  "legal.useTitle": "How we use it",
  "legal.useBody": "Your data is used solely to provide personalized coaching advice. We use the Anthropic API (Claude) to generate coaching responses — your training context is sent to their API with each chat message.",
  "legal.dontTitle": "What we don't do",
  "legal.dontBody": "We do not sell, share, or use your data for advertising. Period.",
  "legal.stravaTitle": "Strava data",
  "legal.stravaBefore": "Strava data is handled per the",
  "legal.stravaLink": "Strava API Agreement",
  "legal.stravaAfter": ".",
  "legal.deleteTitle": "Deleting your data",
  "legal.deleteBefore": "You can delete your account and all associated data by contacting",
  "legal.deleteAfter": ".",
} as const;

export const de: Partial<Record<keyof typeof en, string>> = {
  "auth.tagline": "Lauf wie ein Brokkoli.",
  "auth.mascotAlt": "Brocco beim Laufen",
  "auth.emailPlaceholder": "du@beispiel.de",

  "auth.passwordPlaceholder": "Passwort eingeben",
  "auth.loginFailed": "Anmeldung fehlgeschlagen",
  "auth.haveInvite": "Hast du einen Einladungscode?",

  "auth.joinTitle": "Bei brocco.run mitmachen",
  "auth.inviteNeeded": "Zum Registrieren brauchst du einen Einladungscode.",
  "auth.accessCodePlaceholder": "Der Code, den du von deiner Einladung bekommen hast",
  "auth.namePlaceholder": "Dein Name",
  "auth.newPasswordPlaceholder": "Mindestens 8 Zeichen",
  "auth.creatingAccount": "Konto wird erstellt…",
  "auth.signupFailed": "Registrierung fehlgeschlagen",
  "auth.alreadyHaveAccount": "Hast du schon ein Konto?",

  "auth.forgotIntro": "Gib die E-Mail-Adresse deines Kontos ein, und wir schicken dir einen Link zum Zurücksetzen.",
  "auth.forgotSent": "Wenn zu dieser Adresse ein Konto existiert, ist ein Link zum Zurücksetzen unterwegs. Sieh in deinem Posteingang nach (und im Spam-Ordner).",
  "auth.sending": "Wird gesendet…",
  "auth.sendResetLink": "Link zum Zurücksetzen senden",
  "auth.backToLogin": "Zurück zur Anmeldung",

  "auth.chooseNewPassword": "Neues Passwort wählen",
  "auth.newPassword": "Neues Passwort",
  "auth.repeatNewPassword": "Neues Passwort wiederholen",
  "auth.setNewPassword": "Neues Passwort speichern",
  "auth.passwordsMismatch": "Die Passwörter stimmen nicht überein",
  "auth.minChars": "Mindestens 8 Zeichen",
  "auth.sameAgain": "Noch einmal dasselbe",
  "auth.resetFailed": "Zurücksetzen fehlgeschlagen",
  "auth.resetLinkIncomplete": "Dieser Link zum Zurücksetzen ist unvollständig.",
  "auth.requestNewLink": "Neuen Link anfordern",
  "auth.passwordUpdated": "Passwort aktualisiert. Du wirst zur Anmeldung weitergeleitet…",

  "more.legalLink": "Impressum & Datenschutz",

  "legal.back": "Zurück",
  "legal.title": "Rechtliches",
  "legal.imprintTitle": "Impressum",
  "legal.nameLabel": "Name:",
  "legal.emailLabel": "E-Mail:",
  "legal.nonCommercial": "Dies ist ein nicht-kommerzielles, privates Projekt.",
  "legal.privacyTitle": "Datenschutzerklärung",
  "legal.storeTitle": "Was wir speichern",
  "legal.storeAuth": "Deine E-Mail-Adresse, deinen Namen und den Passwort-Hash zur Anmeldung",
  "legal.storeStrava": "Wenn du Strava verbindest: deine Aktivitätsdaten (Distanz, Pace, Herzfrequenz, Splits usw.) und OAuth-Tokens (verschlüsselt gespeichert)",
  "legal.storeChat": "Chatnachrichten und Coaching-Notizen aus deinen Gesprächen mit Brocco",
  "legal.useTitle": "Wie wir sie nutzen",
  "legal.useBody": "Deine Daten werden ausschließlich dafür genutzt, dir persönliche Coaching-Empfehlungen zu geben. Für die Coaching-Antworten nutzen wir die Anthropic-API (Claude) — dein Trainingskontext wird mit jeder Chatnachricht an deren API übermittelt.",
  "legal.dontTitle": "Was wir nicht tun",
  "legal.dontBody": "Wir verkaufen deine Daten nicht, geben sie nicht weiter und nutzen sie nicht für Werbung. Punkt.",
  "legal.stravaTitle": "Strava-Daten",
  "legal.stravaBefore": "Strava-Daten werden gemäß dem",
  "legal.stravaLink": "Strava API Agreement",
  "legal.stravaAfter": " behandelt.",
  "legal.deleteTitle": "Daten löschen",
  "legal.deleteBefore": "Du kannst dein Konto und alle damit verbundenen Daten löschen lassen, indem du dich meldest bei",
  "legal.deleteAfter": ".",
};

export const es: Partial<Record<keyof typeof en, string>> = {
  "auth.tagline": "Corre como un brócoli.",
  "auth.mascotAlt": "Brocco corriendo",
  "auth.emailPlaceholder": "tu@ejemplo.com",

  "auth.passwordPlaceholder": "Introduce tu contraseña",
  "auth.loginFailed": "No se pudo iniciar sesión",
  "auth.haveInvite": "¿Tienes un código de invitación?",

  "auth.joinTitle": "Únete a brocco.run",
  "auth.inviteNeeded": "Necesitas un código de invitación para registrarte.",
  "auth.accessCodePlaceholder": "El código que te dio quien te invitó",
  "auth.namePlaceholder": "Tu nombre",
  "auth.newPasswordPlaceholder": "Al menos 8 caracteres",
  "auth.creatingAccount": "Creando cuenta…",
  "auth.signupFailed": "No se pudo completar el registro",
  "auth.alreadyHaveAccount": "¿Ya tienes una cuenta?",

  "auth.forgotIntro": "Introduce el correo de tu cuenta y te enviaremos un enlace para restablecer la contraseña.",
  "auth.forgotSent": "Si esa dirección tiene una cuenta, el enlace para restablecer la contraseña está en camino. Revisa tu bandeja de entrada (y la carpeta de spam).",
  "auth.sending": "Enviando…",
  "auth.sendResetLink": "Enviar enlace de restablecimiento",
  "auth.backToLogin": "Volver al inicio de sesión",

  "auth.chooseNewPassword": "Elige una contraseña nueva",
  "auth.newPassword": "Contraseña nueva",
  "auth.repeatNewPassword": "Repite la contraseña nueva",
  "auth.setNewPassword": "Guardar contraseña nueva",
  "auth.passwordsMismatch": "Las contraseñas no coinciden",
  "auth.minChars": "Mínimo 8 caracteres",
  "auth.sameAgain": "La misma otra vez",
  "auth.resetFailed": "No se pudo restablecer la contraseña",
  "auth.resetLinkIncomplete": "Este enlace de restablecimiento está incompleto.",
  "auth.requestNewLink": "Solicitar uno nuevo",
  "auth.passwordUpdated": "Contraseña actualizada. Te llevamos al inicio de sesión…",

  "more.legalLink": "Aviso legal y privacidad",

  "legal.back": "Volver",
  "legal.title": "Información legal",
  "legal.imprintTitle": "Aviso legal (Impressum)",
  "legal.nameLabel": "Nombre:",
  "legal.emailLabel": "Correo:",
  "legal.nonCommercial": "Este es un proyecto personal sin fines comerciales.",
  "legal.privacyTitle": "Política de privacidad",
  "legal.storeTitle": "Qué almacenamos",
  "legal.storeAuth": "Tu correo, tu nombre y el hash de tu contraseña para la autenticación",
  "legal.storeStrava": "Si conectas Strava: tus datos de actividad (distancia, ritmo, frecuencia cardíaca, parciales, etc.) y los tokens OAuth (cifrados en reposo)",
  "legal.storeChat": "Mensajes de chat y notas de coaching de tus conversaciones con Brocco",
  "legal.useTitle": "Cómo los usamos",
  "legal.useBody": "Tus datos se usan únicamente para ofrecerte consejos de entrenamiento personalizados. Usamos la API de Anthropic (Claude) para generar las respuestas de coaching: tu contexto de entrenamiento se envía a su API con cada mensaje de chat.",
  "legal.dontTitle": "Lo que no hacemos",
  "legal.dontBody": "No vendemos, compartimos ni usamos tus datos para publicidad. Punto.",
  "legal.stravaTitle": "Datos de Strava",
  "legal.stravaBefore": "Los datos de Strava se tratan conforme al",
  "legal.stravaLink": "Acuerdo de la API de Strava",
  "legal.stravaAfter": ".",
  "legal.deleteTitle": "Eliminar tus datos",
  "legal.deleteBefore": "Puedes eliminar tu cuenta y todos los datos asociados escribiendo a",
  "legal.deleteAfter": ".",
};
