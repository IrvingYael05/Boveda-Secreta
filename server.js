const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

// ==========================================
// Gestión de Llaves (RSA Servidor)
// ==========================================
if (!fs.existsSync("./keys/server-private.pem")) {
  if (!fs.existsSync("./keys")) fs.mkdirSync("./keys");

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync("./keys/server-private.pem", privateKey);
  fs.writeFileSync("./keys/server-public.pem", publicKey);
}

const SERVER_PRIVATE_KEY = fs.readFileSync("./keys/server-private.pem", "utf8");
const SERVER_PUBLIC_KEY = fs.readFileSync("./keys/server-public.pem", "utf8");

const DB_STORAGE_KEY = crypto.scryptSync(
  "secreto_super_seguro_del_servidor",
  "salt",
  32
);

// Base de datos volátil
const usersDB = [];
const secretsDB = [];

// ==========================================
// Login Seguro (Bcrypt)
// ==========================================
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    //Generamos un par de llaves de firma para el usuario al registrarse
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    usersDB.push({
      username,
      password: hashedPassword, // Guardamos solo el hash
      publicKey, // Guardamos su llave pública para verificar sus firmas
    });

    // Le devolvemos su llave privada al usuario
    res.json({ message: "Usuario registrado", userPrivateKey: privateKey });
  } catch (e) {
    res.status(500).json({ error: "Error al registrar" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = usersDB.find((u) => u.username === username);

  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  // Verificación de Bcrypt
  const validPassword = await bcrypt.compare(password, user.password);

  if (!validPassword)
    return res.status(401).json({ error: "Contraseña incorrecta" });

  res.json({ message: "Login exitoso", username: user.username });
});

// Endpoint para obtener la llave pública del servidor (para cifrado híbrido)
app.get("/api/server-public-key", (req, res) => {
  res.send(SERVER_PUBLIC_KEY);
});

// ==========================================
// Endpoint Principal : Recibe Híbrido, Verifica Firma, Guarda Cifrado
// ==========================================
app.post("/api/vault/save", (req, res) => {
  try {
    const { username, encryptedKey, iv, encryptedData, signature } = req.body;
    console.log(
      `\n--- Recibiendo Secreto de ${username} (Cifrado Híbrido) ---`
    );

    // A. Defensa en Profundidad: Descifrar el Sobre Digital
    // 1. Descifrar la llave AES temporal usando la llave privada del servidor
    const aesKeyBuffer = crypto.privateDecrypt(
      {
        key: SERVER_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encryptedKey, "base64")
    );

    // 2. Descifrar el mensaje usando la llave AES recuperada
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      aesKeyBuffer,
      Buffer.from(iv, "base64")
    );
    let decryptedSecret = decipher.update(encryptedData, "base64", "utf8");
    decryptedSecret += decipher.final("utf8");

    console.log(
      "1. [Híbrido] Dato descifrado en memoria (Texto plano):",
      decryptedSecret
    );

    // B. Autenticidad: Verificar Firma Digital
    const user = usersDB.find((u) => u.username === username);
    const verify = crypto.createVerify("sha256");
    verify.write(decryptedSecret);
    verify.end();

    const isVerified = verify.verify(user.publicKey, signature, "hex");
    console.log(
      "2. [Firma] Verificación de autoría:",
      isVerified ? "AUTÉNTICO" : "FALSO"
    );

    if (!isVerified)
      return res
        .status(403)
        .json({ error: "Firma inválida. Integridad comprometida." });

    // C. Datos en Reposo: Cifrar para la Base de Datos
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
      signature: signature,
    };

    secretsDB.push(newRecord);
    console.log("3. [BD] Registro guardado cifrado:", newRecord);

    res.json({ status: "Secreto resguardado con éxito en la bóveda." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error procesando la seguridad." });
  }
});

// Endpoint extra: Ver la BD
app.get("/api/debug/db", (req, res) => {
  res.json({
    usuarios: usersDB.map((u) => ({ ...u, publicKey: "..." })),
    secretos: secretsDB,
  });
});

app.listen(3000, () =>
  console.log("Servidor Bóveda corriendo en http://localhost:3000")
);
