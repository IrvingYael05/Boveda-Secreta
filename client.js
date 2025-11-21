const crypto = require("crypto");
const axios = require("axios");

const API_URL = "http://localhost:3000";

// Usuario simulado
const USERNAME = "Directivo1";
const PASSWORD = "password123";

async function ejecutarPrueba() {
  try {
    // 1. Registro (Obtenemos las llaves del usuario)
    console.log("--- Registro / Login ---");
    const regRes = await axios.post(`${API_URL}/api/register`, {
      username: USERNAME,
      password: PASSWORD,
    });
    const userPrivateKey = regRes.data.userPrivateKey;
    console.log("Usuario logueado. Llave privada cargada en memoria.");

    // 2. Obtener llave pública del servidor
    const pubRes = await axios.get(`${API_URL}/api/server-public-key`);
    const serverPublicKey = pubRes.data;

    // 3. Secreto a Enviar
    const secreto = "La fórmula de la Coca-Cola es: Azúcar + Cola";
    console.log(`\n--- Preparando Secreto: "${secreto}" ---`);

    // 4. Cifrado Simétrico (AES) del mensaje
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
    let encryptedData = cipher.update(secreto, "utf8", "base64");
    encryptedData += cipher.final("base64");

    // 5. Cifrado Asímetrico (RSA) de la llave AES (Sobre Digital)
    const encryptedKey = crypto.publicEncrypt(
      {
        key: serverPublicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey
    );

    // 6. Firma Digital (ECC) del mensaje original (No repudio)
    const sign = crypto.createSign("sha256");
    sign.write(secreto);
    sign.end();
    const signature = sign.sign(userPrivateKey, "hex");
    console.log(
      "Firma generada:",
      signature.substring(0, 20) + "..."
    );

    // 7. Enviar Payload Híbrido
    const payload = {
      username: USERNAME,
      encryptedKey: encryptedKey.toString("base64"),
      iv: iv.toString("base64"),
      encryptedData: encryptedData,
      signature: signature,
    };

    console.log("\n--- 3. Enviando Sobre Digital al Servidor ---");
    const serverRes = await axios.post(`${API_URL}/api/vault/save`, payload);
    console.log("Respuesta del Servidor:", serverRes.data);

    // 8. Verificar BD
    const dbRes = await axios.get(`${API_URL}/api/debug/db`);
    console.log("\n--- 4. Verificación de Datos en Reposo (BD) ---");
    console.log(JSON.stringify(dbRes.data.secretos, null, 2));
  } catch (error) {
    console.error(error.response ? error.response.data : error.message);
  }
}

ejecutarPrueba();
