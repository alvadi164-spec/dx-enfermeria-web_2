# 🩺 Dx Enfermería Web · NANDA-I · NIC · NOC · CKM 2026

Aplicación web de diagnóstico de enfermería. Sin instalación — solo abre el link.

## 🚀 Deploy gratuito en Railway (recomendado)

### Paso 1 — Sube el código a GitHub
1. Ve a **github.com** → New repository → nombre: `dx-enfermeria`
2. Sube estos archivos (arrastra la carpeta o usa GitHub Desktop)

### Paso 2 — Despliega en Railway
1. Ve a **railway.app** → Login con GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Selecciona `dx-enfermeria`
4. Railway lo detecta como Node.js y despliega automáticamente
5. En **Settings → Domains** → **Generate Domain** → obtienes tu URL pública

### Paso 3 — ¡Listo!
Abre tu URL (ej: `https://dx-enfermeria-production.up.railway.app`) desde cualquier dispositivo.

**Costo:** Gratis (Railway incluye $5 USD/mes de crédito, la app usa ~$0.50/mes)

---

## 🔄 Otras opciones gratuitas

### Render.com
1. render.com → New → Web Service → Connect GitHub
2. Build Command: (vacío)
3. Start Command: `node server.js`
4. Free plan → Deploy

### Fly.io
```bash
npm install -g flyctl
fly auth login
fly launch
fly deploy
```

---

## 🔑 Uso
La app pide la API Key de Anthropic al usuario directamente en la interfaz.
Cada usuario usa su propia clave — no se almacena en el servidor.

- API Key: console.anthropic.com → API Keys
- Costo por diagnóstico: ~$0.003 USD
- $5 USD gratis al registrarse ≈ 1,500 diagnósticos

---

## ⚙️ Variables de entorno
Ninguna requerida. El servidor usa `PORT` del entorno automáticamente.

---
*NANDA-I 2024-2026 · NIC 8ª ed. · NOC 7ª ed. · Guía CKM 2026 AHA/ACC/ADA/ASN*
