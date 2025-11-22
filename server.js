const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Archivos estáticos (FRONTEND)
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// 1. GESTIÓN DE LLAVES (RSA SERVIDOR)
// ==========================================
const KEYS_DIR = "./keys";
if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR);

const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "server-private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "server-public.pem");

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.log("Generando llaves RSA del servidor...");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey);
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
}

const SERVER_PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
const SERVER_PUBLIC_KEY = fs.readFileSync(PUBLIC_KEY_PATH, "utf8");

// Llave maestra para cifrado en reposo
const DB_STORAGE_KEY = crypto.scryptSync(
  "secreto_maestro_servidor",
  "salt_fijo_demo",
  32
);

// Base de datos en memoria
const usersDB = [];
const secretsDB = [];

// ==========================================
// 2. LOGIN SEGURO (BCRYPT)
// ==========================================
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    // Hasheo de contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (usersDB.find((u) => u.username === username)) {
      return res.status(400).json({ error: "El usuario ya existe" });
    }

    usersDB.push({
      username,
      password: hashedPassword, // Solo se guarda el hash
      publicKey: null, // La llave pública se generará en el login
    });

    console.log(`\n--- [SERVER] Registrando nuevo usuario: ${username} ---`);
    console.log(`1. Usuario registrado: ${username}, Hash: ${hashedPassword}`);

    res.json({ message: "Usuario registrado exitosamente" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al registrar" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = usersDB.find((u) => u.username === username);

  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword)
    return res.status(401).json({ error: "Contraseña incorrecta" });

  // Se genera un nuevo par de llaves para la sesión.
  // La llave pública se actualiza en la "BD" y la privada se envía al cliente.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  user.publicKey = publicKey; // Se actualiza la llave pública del usuario

  console.log(`\n--- [SERVER] Usuario autenticado: ${username} ---`);
  console.log(
    `1. Usuario autenticado y nueva llave pública asignada a ${username}`
  );

  res.json({
    message: "Login exitoso",
    username: user.username,
    userPrivateKey: privateKey,
  });
});

app.get("/api/server-public-key", (req, res) => {
  res.send(SERVER_PUBLIC_KEY);
});

// ==========================================
// 3. DEFENSA EN PROFUNDIDAD (CIFRADO HÍBRIDO)
// ==========================================
app.post("/api/vault/save", (req, res) => {
  try {
    const { username, encryptedKey, iv, encryptedData, signature } = req.body;
    console.log(`\n--- [SERVER] Recibiendo Secreto de ${username} ---`);

    // A. DESCIFRADO HÍBRIDO (El Sobre Digital)
    // 1. Descifrar la llave AES simétrica usando la llave privada RSA del servidor
    const aesKeyBuffer = crypto.privateDecrypt(
      {
        key: SERVER_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedKey, "base64")
    );

    console.log("1. Llave AES recuperada exitosamente.");

    // 2. Descifrar el mensaje (Secreto) usando la llave AES recuperada
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      aesKeyBuffer,
      Buffer.from(iv, "base64")
    );
    let decryptedSecret = decipher.update(encryptedData, "base64", "utf8");
    decryptedSecret += decipher.final("utf8");

    console.log("2. Secreto descifrado:", decryptedSecret);

    // B. AUTENTICIDAD Y NO REPUDIO (Verificar Firma)
    const user = usersDB.find((u) => u.username === username);

    // Verificación de firma
    const verify = crypto.createVerify("sha256");
    verify.write(decryptedSecret);
    verify.end();

    const isVerified = verify.verify(
      user.publicKey,
      Buffer.from(signature, "hex")
    );

    console.log(
      "3. Verificación de Firma Digital:",
      isVerified ? "VÁLIDA" : "INVÁLIDA"
    );

    if (!isVerified)
      return res
        .status(403)
        .json({ error: "Firma inválida. Integridad comprometida." });

    // C. DATOS EN REPOSO (Cifrado Simétrico para BD)
    const storageIv = crypto.randomBytes(16);
    const cipherStorage = crypto.createCipheriv(
      "aes-256-cbc",
      DB_STORAGE_KEY,
      storageIv
    );
    let secretForDb = cipherStorage.update(decryptedSecret, "utf8", "hex");
    secretForDb += cipherStorage.final("hex");

    const newRecord = {
      id: secretsDB.length + 1,
      owner: username,
      secret_cifrado: secretForDb,
      iv: storageIv.toString("hex"),
      signature: signature, // Se guarda  la firma para auditoría
    };

    secretsDB.push(newRecord);

    res.json({ status: "Secreto guardado y verificado." });
  } catch (error) {
    console.error("Error en procesamiento:", error.message);
    res.status(500).json({ error: "Error criptográfico en servidor." });
  }
});

// Endpoint para auditoría (Mostrar datos cifrados)
app.get("/api/debug/db", (req, res) => {
  res.json({
    usuarios: usersDB.map((u) => ({
      username: u.username,
      passwordHash: u.password.substring(0, 20) + "...",
    })),
    secretos: secretsDB,
  });
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
);
