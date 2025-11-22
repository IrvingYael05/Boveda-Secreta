# Bóveda Corporativa Segura

Este proyecto es una implementación de un sistema de **mensajería y almacenamiento seguro** ("Bóveda") desarrollado con una arquitectura Cliente-Servidor. Utiliza una interfaz web moderna que implementa cifrado *Client-Side* (en el navegador) para garantizar que los secretos viajen y se almacenen de forma segura.

Garantiza los pilares de seguridad: **Confidencialidad, Autenticidad, Integridad y No Repudio**.

## Características Principales

El sistema permite a un usuario (ej. Directivo) enviar un secreto industrial al servidor, asegurando el flujo completo mediante:

* **Cifrado Híbrido (Sobre Digital):**
    * **Simétrico:** Uso de **AES-256-CBC** (generado en el navegador) para cifrar el mensaje.
    * **Asimétrico:** Uso de **RSA-OAEP** (2048 bits) para cifrar la llave AES y enviarla al servidor de forma segura.
* **Firma Digital (No Repudio):**
    * Uso de **RSA-SHA256** (RSASSA-PKCS1-v1_5) para firmar el mensaje original.
    * El servidor verifica la firma criptográfica para garantizar que el mensaje proviene del usuario autenticado y no ha sido modificado en tránsito.
* **Seguridad Client-Side (End-to-End):**
    * Uso de la **Web Crypto API** nativa. Los datos salen del navegador ya cifrados; el texto plano nunca toca la red.
* **Datos en Reposo:**
    * El servidor vuelve a cifrar los datos antes de guardarlos en la base de datos interna usando una llave maestra derivada con **Scrypt** y un IV único por registro.

## Stack Tecnológico

* **Frontend:** HTML5, Tailwind CSS, JavaScript (Web Crypto API, Fetch API).
* **Backend:** Node.js, Express.
* **Criptografía:**
    * *Browser:* `window.crypto.subtle` (Estándar W3C).
    * *Server:* Módulo nativo `crypto` de Node.js.
* **Hashing:** `bcrypt` (para contraseñas).

## Flujo de Ejecución

1.  **Registro:** El usuario crea una cuenta. La contraseña se almacena hasheada (Bcrypt).
2.  **Login y Handshake:**
    * Al iniciar sesión, el servidor genera dinámicamente un par de llaves RSA para la sesión.
    * Envía la **Llave Privada** al cliente (para firmar) y retiene la Pública (para verificar).
    * El cliente solicita la Llave Pública del Servidor (para cifrar el sobre).
3.  **Preparación del Payload (En el Navegador):**
    * Se genera una llave efímera AES-256.
    * Se cifra el secreto con AES.
    * Se cifra la llave AES con la Pública del Servidor (Sobre Digital).
    * Se firma el secreto original con la Privada del Usuario.
4.  **Envío:** Se envían al servidor: `[Llave AES Cifrada] + [Data Cifrada] + [Firma] + [IV]`.
5.  **Recepción y Verificación:**
    * El servidor abre el sobre digital (usa su Privada RSA).
    * Descifra el mensaje (usa la llave AES recuperada).
    * Verifica la firma contra la llave pública del usuario en sesión.
    * Si es válido, recifra el dato con la llave de la BD y lo almacena.

## Instalación y Uso

1.  **Clonar el repositorio**
    ```bash
    git clone https://github.com/IrvingYael05/Boveda-Secreta.git
    cd Boveda-Secreta
    ```

2.  **Instalar dependencias**
    ```bash
    npm install express bcrypt cors
    ```

3.  **Ejecutar el Servidor**
    ```bash
    node server.js
    ```
    Verás el mensaje: `Servidor corriendo en http://localhost:3000`

4.  **Usar la Aplicación**
    * Abre tu navegador web e ingresa a: **`http://localhost:3000`**
    * Registra un usuario.
    * Inicia sesión.
    * Escribe un secreto y presiona "Proteger y Enviar".
    * Observa los logs de seguridad en la consola visual de la derecha.

## 📊 Diagrama de Secuencia

```mermaid
sequenceDiagram
    participant C as Cliente (Navegador)
    participant S as Servidor (API)
    participant DB as Base de Datos (Memoria)

    Note over C,DB: Fase 0: Registro y Autenticación (Handshake)
    C->>S: POST /api/register (Usuario + Password)
    S-->>C: 200 OK (Usuario registrado, sin llaves)
    
    C->>S: POST /api/login (Usuario + Password)
    Note right of S: Genera Par de Llaves RSA<br/>para esta sesión específica
    S->>DB: Actualiza user.publicKey en memoria
    S-->>C: Retorna userPrivateKey + 200 OK

    C->>S: GET /api/server-public-key
    S-->>C: Retorna SERVER_PUBLIC_KEY

    Note over C,S: Fase 1: Preparación del Payload (Cliente)
    C->>C: Genera Llave AES-256 Temporal (Simétrica)
    C->>C: Cifra el Secreto con la Llave AES
    C->>C: Cifra la Llave AES con RSA Pública del Servidor (Sobre Digital)
    C->>C: Firma el Secreto ORIGINAL con userPrivateKey (RSA-SHA256)

    Note over C,S: Fase 2: Envío Seguro
    C->>S: POST /api/vault/save (Key Cifrada + Data Cifrada + Firma)

    Note over S,DB: Fase 3: Recepción y Verificación
    S->>S: Descifra Llave AES usando RSA Privada del Servidor
    S->>S: Descifra Data usando la Llave AES recuperada
    S->>DB: Consulta user.publicKey del usuario
    S->>S: Verifica Firma Digital sobre el texto plano recuperado

    Note over S,DB: Fase 4: Almacenamiento Seguro
    alt Firma Válida
        S->>S: Cifra Data con Llave Maestra de BD (AES-Storage-Key)
        S->>DB: Guarda (Data Cifrada + IV + Firma)
        S-->>C: 200 OK (Secreto resguardado)
    else Firma Inválida
        S-->>C: 403 Forbidden (Integridad comprometida)
    end