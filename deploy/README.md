# Deploy del mini-erp en AWS Lightsail

Guía paso a paso para publicar el mini-erp en internet (#3), pensada para alguien que **nunca usó
Ubuntu ni Lightsail**. Se hace una sola vez; después cada versión nueva se publica sola desde GitHub.

¿El servidor ya existe y todavía corre la versión con SQLite (0.17.0 o anterior)? Andá directo a
[Pasar a PostgreSQL](#pasar-a-postgresql-una-sola-vez).

## Cómo queda armado

```
Internet ──https──▶ Caddy (puertos 80/443, certificado automático)
                      │
                      ▼
                   mini-erp (Node 24, puerto 4100, solo accesible desde la misma máquina)
                      │ socket Unix, sin contraseña
                      ▼
                   PostgreSQL 16 (base minierp: esquema system y uno por comercio)
                      │
                      ▼
                   /mnt/pgdata               (disco adicional de Lightsail: los datos de PostgreSQL)
                   /var/lib/mini-erp-backups (pg_dump de cada noche y de antes de cada deploy, 7 días)
```

- **Lightsail** es el servicio de AWS que alquila una computadora virtual (una "instancia") a precio
  fijo: US$5 por mes.
- **Ubuntu** es el sistema operativo de esa computadora. Se maneja escribiendo comandos en una
  terminal; Lightsail trae una **terminal en el navegador**, así que no hace falta instalar nada.
- **Caddy** recibe las visitas por HTTPS y se las pasa al mini-erp. Pide y renueva solo el
  certificado.
- **PostgreSQL** guarda todo: usuarios, comercios y los datos de cada comercio. Corre en la misma
  instancia y solo atiende por el socket local (nada por la red). Sus archivos están en un **disco
  adicional** de Lightsail, montado en `/mnt/pgdata`: crece aparte y no se mezcla con el sistema.
- **El nombre**: un dominio propio (hoy **`mini.contax.ar`**, con el DNS en DreamHost) que apunta a
  la IP de la instancia. Los sinónimos (`mini.contax.com.ar`) y el nombre viejo redirigen al
  principal. Sin dominio propio sirve **sslip.io**, un servicio gratis que convierte una IP en un
  nombre (`203-0-113-10.sslip.io` apunta a `203.0.113.10`), aunque algunos proveedores de internet
  no lo resuelven (#11).
- **GitHub Actions** arma cada versión, corre todos los tests y la sube a la instancia por SSH.

Hay dos usuarios en la instancia, además del tuyo (`ubuntu`, el administrador):

- `minierp` corre el servicio y el backup. En PostgreSQL entra como el rol `minierp`, dueño de la
  base, sin contraseña: PostgreSQL le cree al sistema quién es (autenticación `peer`).
- `deploy` es el que usa GitHub Actions para subir versiones. Solo puede eso, reiniciar el servicio y
  correr el backup antes de activar una versión. Está en el grupo `systemd-journal` para leer el log
  del backup si esa copia falla.

## Lo que vas a necesitar

- Tu cuenta de AWS.
- Acceso de administrador al repo `rauldiazsolis/mini-erp` en GitHub.
- Una PowerShell en tu Windows (menú Inicio → escribir "PowerShell").
- Unos 45 minutos a una hora.

Convención de esta guía: donde dice `<IP>` va la IP estática de la instancia (por ejemplo
`203.0.113.10`) y donde dice `<HOST>`, el nombre público principal: tu dominio (por ejemplo
`mini.contax.ar`) o, sin dominio, la IP con guiones más `.sslip.io` (por ejemplo
`203-0-113-10.sslip.io`). `<SINÓNIMOS>` son los nombres que redirigen al principal (por ejemplo
`mini.contax.com.ar`); pueden no ser ninguno.

---

## Paso 1: crear la instancia en Lightsail

1. Entrá a <https://lightsail.aws.amazon.com/> con tu cuenta de AWS.
2. Botón **Create instance**.
3. **Instance location**: elegí la región. **Virginia (us-east-1)** es la de referencia de precios;
   si ves otra más cercana (por ejemplo São Paulo) con el mismo precio de US$5, también sirve. Para
   cambiarla: "Change AWS Region and Availability Zone".
4. **Pick your instance image**:
   - Platform: **Linux/Unix**.
   - Blueprint: pestaña **Operating System (OS) only** → **Ubuntu 24.04 LTS**.
5. **SSH key pair**: dejá la que viene por defecto. No la vas a usar: la terminal del navegador
   entra sola.
6. **Choose your instance plan**:
   - Tipo de red: **Dual-stack** (con IPv4). **No** elijas "IPv6-only": el POS y muchos
     navegadores necesitan IPv4.
   - Plan: el de **US$5 USD/month** (512 MB de memoria, 2 vCPU, 20 GB de SSD). Si dice "First 3
     months free", mejor todavía.
7. **Identify your instance**: nombre `mini-erp`.
8. Botón **Create instance**. Esperá a que el estado pase de "Pending" a **Running** (1 o 2 minutos).

## Paso 2: IP fija, puertos y snapshots

Entrá a la instancia (clic en su nombre, `mini-erp`).

**IP estática** (sin esto, la IP cambia si la instancia se reinicia y el nombre deja de apuntar a
ella):

1. Pestaña **Networking** → en "IPv4 networking", **Attach static IP** (o **Create static IP**).
2. Nombre: `mini-erp-ip` → **Create** (o **Attach**).
3. Anotá la IP que aparece: es tu `<IP>`.

   > La IP estática es gratis **mientras esté asignada** a una instancia. Si algún día borrás la
   > instancia, borrá también la IP estática (pestaña Networking de la cuenta), porque suelta cobra.

**Puertos** (en la misma pestaña Networking, sección **IPv4 Firewall**):

1. Ya tienen que estar **SSH (22)** y **HTTP (80)**.
2. **Add rule** → Application: **HTTPS** (puerto 443) → **Create**.

**Snapshots automáticos** (copia diaria de todo el disco, que guarda AWS):

1. Pestaña **Snapshots** → **Automatic snapshots** → activarlo.
2. Horario: cualquiera (por ejemplo 06:00 UTC). AWS guarda los últimos 7. Cuestan centavos por mes.
3. Cuando tengas el disco de PostgreSQL (paso 2c), confirmá en la pestaña **Snapshots** que el
   snapshot automático de la instancia lo incluya; si no, activá también los automáticos del disco
   (su propia pestaña **Snapshots**). El backup de verdad de los datos es el `pg_dump` de cada noche
   (ver [Backups](#backups)); el snapshot sirve para rehacer la instancia entera.

## Paso 2b: el nombre (DNS)

**Con dominio propio** (el DNS de `contax.ar` y `contax.com.ar` está en DreamHost):

1. En el panel de DreamHost, la sección de **DNS** del dominio (`contax.ar`).
2. Agregá un registro (**Add Record**): tipo **A**, nombre **`mini`**, valor **`<IP>`**.
3. Lo mismo en `contax.com.ar` para cada sinónimo (nombre `mini`, valor `<IP>`).
4. Esperá a que se publique (de minutos a un par de horas). Para saber si ya está, en PowerShell:

   ```powershell
   nslookup mini.contax.ar 8.8.8.8
   ```

   Tiene que responder con la `<IP>`. Recién entonces seguí: Caddy pide el certificado apenas
   arranca, y si el nombre todavía no apunta a la instancia, falla y reintenta más tarde.

**Sin dominio**: `<HOST>` es la IP con los puntos cambiados por guiones más `.sslip.io`. No hay que
cargar nada.

## Paso 2c: el disco de PostgreSQL

PostgreSQL guarda sus archivos en un disco aparte, montado en `/mnt/pgdata`. Sin ese disco,
`provision.sh` no instala nada: se frena y repite estas instrucciones.

**Crearlo y adjuntarlo** (en la consola de Lightsail):

1. Entrá a la instancia → pestaña **Storage** → **Create new disk** (si no aparece: menú
   **Storage** de la cuenta → **Create disk**, en la **misma zona** que la instancia).
2. Tamaño: **8 GB** alcanza para empezar (es el mínimo; menos de US$1 por mes). Nombre:
   `mini-erp-pgdata`.
3. Si lo creaste desde el menú de la cuenta: en el disco, **Attach** → la instancia `mini-erp`.
4. Esperá a que diga **Attached** (unos segundos).

**Montarlo** (en la terminal de Lightsail, paso 4.1; de a una línea):

- [ ] **Ver qué dispositivo es.**

  ```bash
  lsblk
  ```

  El disco nuevo es el de 8G **sin particiones ni `MOUNTPOINTS`**; en estas instancias suele ser
  `/dev/nvme1n1` (el del sistema es `nvme0n1`, con sus particiones). En los comandos que siguen va
  ese nombre.
- [ ] **Formatearlo, solo si es nuevo.** Esto **borra** lo que tenga. Primero confirmá que está
  vacío:

  ```bash
  sudo file -s /dev/nvme1n1
  ```

  Si responde `/dev/nvme1n1: data`, está vacío y se formatea:

  ```bash
  sudo mkfs -t ext4 /dev/nvme1n1
  ```

  Si dice `ext4 filesystem data`, ya tiene datos (un disco que se vuelve a adjuntar o creado desde un
  snapshot): **no** se formatea, se salta este paso.
- [ ] **Montarlo para siempre.** El `fstab` lo monta en cada arranque; va por `UUID` porque el
  nombre `nvme1n1` puede cambiar, y con `nofail` la instancia arranca aunque el disco falte
  (PostgreSQL no: espera al disco).

  ```bash
  sudo mkdir -p /mnt/pgdata
  ```

  ```bash
  echo "UUID=$(sudo blkid -s UUID -o value /dev/nvme1n1) /mnt/pgdata ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
  ```

  ```bash
  sudo mount -a && mountpoint /mnt/pgdata
  ```

  Tiene que decir `/mnt/pgdata is a mountpoint`. Con `df -h /mnt/pgdata` se ve el tamaño.

## Paso 3: la llave de deploy (en tu Windows)

GitHub Actions necesita una llave para entrar a la instancia como `deploy`. Es un par de archivos: la
**privada** (secreta, va a GitHub) y la **pública** (va a la instancia).

En PowerShell:

```powershell
ssh-keygen -t ed25519 -f $HOME\mini-erp-deploy -C deploy@mini-erp
```

Cuando pregunte "Enter passphrase", apretá **Enter** dos veces (sin contraseña: GitHub la usa sin
nadie delante). Se crean `mini-erp-deploy` (privada) y `mini-erp-deploy.pub` (pública) en tu carpeta
de usuario.

Mostrá la pública; la vas a copiar en el paso 4:

```powershell
Get-Content $HOME\mini-erp-deploy.pub
```

Es una sola línea que empieza con `ssh-ed25519`.

## Paso 4: preparar la instancia

1. En Lightsail, pestaña **Connect** de la instancia → **Connect using SSH**. Se abre una ventana
   negra: es la terminal de la instancia, ya conectada como `ubuntu`.
2. **Para pegar** en esa terminal: botón del portapapeles abajo a la derecha de la ventana → pegar
   el texto en el cuadro → después, clic derecho en la terminal (o `Ctrl+Shift+V`).
3. Bajá el repo (en una línea):

   ```bash
   git clone -b main https://github.com/rauldiazsolis/mini-erp.git /tmp/mini-erp
   ```

   (La primera vez, antes del merge, se usa la rama del PR en lugar de `main`.)
4. Corré la preparación, reemplazando `<HOST>`, pegando **tu** clave pública entre las comillas y
   agregando al final los `<SINÓNIMOS>`, si los hay:

   ```bash
   sudo bash /tmp/mini-erp/deploy/provision.sh <HOST> "ssh-ed25519 AAAA... deploy@mini-erp" <SINÓNIMOS>
   ```

   Por ejemplo: `… provision.sh mini.contax.ar "ssh-ed25519 AAAA…" mini.contax.com.ar`.

   Tarda unos minutos: instala Node, pnpm, Caddy y PostgreSQL 16, arma el cluster de PostgreSQL en
   el disco (`/mnt/pgdata/16/main`, con la memoria ajustada a una instancia de 512 MB y solo por el
   socket local), crea el rol y la base `minierp`, un swap de 1 GB, los usuarios, el entorno
   (`/etc/mini-erp/env`) y los servicios. Tiene que terminar con:

   ```
   Listo: Node v24.x.x, Caddy v2.x.x, sitio https://<HOST>
   PostgreSQL 16.x con los datos en /mnt/pgdata/16/main, base minierp por el socket (peer)
   ```

   Si algo falla, se puede volver a correr: no rompe lo que ya hizo. Se frena sin tocar nada si
   `/mnt/pgdata` no está montado (volvé al paso 2c) o si el disco trae un cluster de otra instancia
   (ver [El disco ya tiene un cluster](#el-disco-ya-tiene-un-cluster)).

## Paso 5: los secretos en GitHub

1. En GitHub, el repo `rauldiazsolis/mini-erp` → **Settings** → **Environments** → **New
   environment** → nombre `production` → **Configure environment**.
2. En **Environment secrets**, **Add environment secret** cuatro veces:

   | Nombre | Valor |
   |---|---|
   | `SSH_HOST` | `<IP>` (solo la IP, con puntos) |
   | `SSH_USER` | `deploy` |
   | `SSH_PRIVATE_KEY` | el contenido de la llave **privada** (ver abajo) |
   | `SSH_KNOWN_HOSTS` | la huella de la instancia (ver abajo) |

   Para copiar la llave privada al portapapeles **sin mostrarla** en pantalla, en PowerShell:

   ```powershell
   Get-Content $HOME\mini-erp-deploy -Raw | Set-Clipboard
   ```

   y pegala en el valor de `SSH_PRIVATE_KEY`.

   Para la huella (le dice a GitHub que la instancia es la verdadera y no un impostor), en la
   **terminal de Lightsail**, reemplazando `<IP>`:

   ```bash
   echo "<IP> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
   ```

   Imprime una línea que empieza con la IP y sigue con `ssh-ed25519 AAAA…`. Seleccionala entera,
   copiala (`Ctrl+Shift+C`) y pegala en `SSH_KNOWN_HOSTS`.

   > No uses `ssh-keyscan` desde Windows: su OpenSSH es viejo y falla con
   > `choose_kex: unsupported KEX method` contra Ubuntu 24.04.

3. Más abajo, en **Environment variables** (no en los secretos: el workflow la lee como variable y,
   si está como secreto, le llega vacía), **Add environment variable**: nombre `PUBLIC_HOST`, valor
   `<HOST>`.
4. Opcional, también en **Environment variables**: `POS_URL`, el origen del POS al que lleva el botón
   "Probar la demo". Si no está, es `https://pos.contax.ar`; el link le suma el canal del contrato
   (`/v4/`).

Después de cargar la llave privada en GitHub, guardá el archivo `mini-erp-deploy` en un lugar seguro
(o borralo: si hace falta, se genera otra y se repiten los pasos 3 a 5).

## Paso 6: publicar una versión

La versión de mini es **la de `package.json`**, y es la única (#40): la muestran el admin y el
landing, y la informan `/health` y `GET /connector/info`. Para publicar una:

1. En el PR de la etapa, subí la versión: `pnpm version minor --no-git-tag-version` para una etapa,
   `pnpm version patch --no-git-tag-version` para un arreglo. Cambia solo `package.json`.
2. Después del merge, desde `main` actualizado, creá el tag **desde `package.json`** y subilo, en
   PowerShell, en la carpeta del repo:

   ```bash
   git checkout main
   ```

   ```bash
   git pull
   ```

   ```bash
   pnpm release:tag
   ```

   Tiene que terminar con `Tag vX.Y.Z creado y subido: el deploy arranca solo`. Antes de crear nada,
   verifica que estés en `main`, sin cambios sin commitear, igual que `origin/main` y con un tag que
   todavía no existe. Si algo no cierra, se frena y dice qué hacer (#49).

También se puede publicar a mano desde GitHub: pestaña **Actions** → **Deploy** → **Run workflow**
(sobre `main`). Despliega la versión que diga `package.json`.

El workflow tarda unos minutos:

- Primero compara el tag con `package.json`. Si no coinciden (por ejemplo `v0.3.0` con `0.2.1`), se
  frena ahí, sin tocar el servidor, y dice qué corregir.
- Después corre el CI entero (lint, tipos, tests, build y e2e) y sube la versión. Antes de
  activarla hace una **copia previa** de la base (`pg_dump`); si la copia falla, no la activa. Si la
  versión trae migraciones, el mini-erp atiende "en mantenimiento" mientras migra y el deploy espera
  hasta 15 minutos (ver [Migraciones de esquema](#migraciones-de-esquema)). Si el mini-erp nuevo no
  responde o la migración falla, **vuelve solo a la versión anterior** y el workflow queda en rojo.
- Al final pide `https://<HOST>/health` y comprueba que responda la versión que se acaba de subir.

Cuando termine en verde, abrí `https://<HOST>/` en el navegador: tiene que aparecer el landing del
mini-erp con el candado de HTTPS.

> Con `sslip.io`, si el navegador dice que no encuentra el sitio, puede ser tu proveedor de
> internet: algunos no lo resuelven (#11). En Chrome: Configuración → Privacidad y seguridad →
> Seguridad → "Usar DNS seguro" con Google o Cloudflare. Con dominio propio no pasa.

## Paso 7: crear el root (una sola vez)

El root es la cuenta de administrador que ve todos los comercios. Nadie puede registrarse como root
desde la web, y la base nueva arranca sin ninguna cuenta.

En la terminal de Lightsail (paso 4.1), en una línea:

```bash
sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
```

Corre como `minierp` (el único que entra a la base) y con el entorno del servicio (`set -a` exporta
lo que carga de `/etc/mini-erp/env`, `DATABASE_URL` incluida). Te pide email, nombre y la contraseña
dos veces (mínimo 8 caracteres, el mismo de todas las cuentas). **La contraseña no se ve mientras la
escribís**: es normal. Termina con `Root creado: <tu email>`. Con eso entrás al admin en
`https://<HOST>/admin`.

Si te olvidás la contraseña, correr lo mismo con el mismo email le pone una nueva.

## Operación del día a día

Todo en la terminal de Lightsail.

| Para | Comando |
|---|---|
| Ver si el mini-erp está andando | `systemctl status mini-erp` (tecla `q` para salir) |
| Ver el log en vivo | `journalctl -u mini-erp -f` (`Ctrl+C` para salir) |
| Confirmar el barrido de demos | `journalctl -u mini-erp \| grep demos` |
| Ver si PostgreSQL está andando | `systemctl status postgresql@16-main` (tiene que decir `active (running)`) |
| Ver cuánto disco usa PostgreSQL | `df -h /mnt/pgdata` |
| Entrar a la base | `cd / && sudo -u minierp psql minierp` (`\q` para salir; ver abajo) |
| Ver cuándo corre el próximo backup | `systemctl list-timers mini-erp-backup.timer` |
| Ver los backups | `sudo ls -lh /var/lib/mini-erp-backups` |
| Ver el log del último backup | `sudo journalctl -u mini-erp-backup.service -n 20 --no-pager` |
| Cambiar la configuración | `sudo nano /etc/mini-erp/env` (guardar: `Ctrl+O`, Enter, `Ctrl+X`) y después `sudo systemctl restart mini-erp` |
| Reiniciar el mini-erp | `sudo systemctl restart mini-erp` |

Las variables de `/etc/mini-erp/env` están explicadas en el README principal.

**Mirar la base con `psql`.** `sudo -u minierp psql minierp` entra como el servicio (el `cd /` evita
que `psql` se queje de no poder leer tu carpeta). Adentro, por ejemplo:

- `\dn` lista los esquemas: `system` y un `tenant_<id>` por comercio (demos incluidas).
- `SELECT version, name, applied_at FROM system.schema_migrations ORDER BY version;` muestra las
  migraciones aplicadas al esquema de sistema.
- `SELECT id, name FROM system.tenants;` lista los comercios.

Para mirar, no para cambiar datos a mano: lo que se toca por acá no queda auditado.

**Cambiar a dónde abre el POS el botón "Probar la demo"** (si el POS se muda de dominio), sin
terminal: en GitHub, Settings → Environments → `production` → Environment variables → `POS_URL` = el
origen nuevo (crearla si no está), y después Actions → **Deploy** → **Run workflow**. El valor queda
dentro del landing al compilar, por eso hace falta el deploy. El canal (`/v4/`) no se configura: sale
del contrato implementado.

## Cambiar el nombre (mudarse de dominio)

Por ejemplo, de `52-203-224-101.sslip.io` a `mini.contax.ar`:

1. Cargá el DNS del nombre nuevo (paso 2b) y esperá a que responda con la `<IP>`.
2. En la terminal de Lightsail, con la guía al día (`git -C /tmp/mini-erp pull`, o un `git clone`
   nuevo como en el paso 4), el nombre nuevo primero y después los sinónimos. Conviene incluir el
   nombre viejo, así los links que ya circulan siguen andando:

   ```bash
   sudo bash /tmp/mini-erp/deploy/set-host.sh mini.contax.ar mini.contax.com.ar 52-203-224-101.sslip.io
   ```

   Reescribe Caddy y `PUBLIC_URL`, y reinicia el mini-erp. Termina mostrando el host principal y a
   dónde redirige cada sinónimo.
3. En GitHub, la variable `PUBLIC_HOST` del environment `production` pasa al nombre nuevo.

Los sinónimos sirven para el navegador (landing, admin y alta). **Una caja ya conectada al nombre
viejo no sigue la redirección** (el navegador no sigue una redirección entre dominios en las llamadas
del POS): hay que volver a conectarla con el nombre nuevo. Las demos nuevas ya salen con el nombre
nuevo.

## Migraciones de esquema

Producción tiene datos que no se pueden perder: el esquema se migra, nunca se borra ni se reinicia
una base. Cada deploy, antes de activar la versión nueva:

1. **Copia previa.** `deploy.sh` corre el backup (`mini-erp-backup.service`) con el código de la
   versión activa, que es la que conoce la base tal como está. Si la copia falla, **no activa** la
   versión nueva y el workflow queda en rojo con el log del backup. En el log del workflow (paso del
   deploy por SSH) se ve:

   ```
   Copia previa de la base (mini-erp-backup.service)
   Copia previa: /var/lib/mini-erp-backups/minierp-2026-11-20T14-30-05Z.dump
   ```

   La primera vez (sin versión activa) y en el paso a PostgreSQL (la activa todavía es de SQLite)
   dice `sin copia previa`: no hay nada que copiar.
2. **Mantenimiento.** La versión nueva escucha enseguida y responde "en mantenimiento": `/health` da
   `503` con `"status":"maintenance"`, el POS deja de sincronizar y sigue vendiendo, y el admin
   muestra "Estamos actualizando mini contax".
3. **Migra** el esquema `system` y el de cada comercio, demos incluidas, y recién ahí atiende normal.
   El POS sincroniza lo que vendió mientras tanto.

`deploy.sh` espera hasta 15 minutos mientras `/health` diga `maintenance`. Si la versión nueva no
atiende o la migración falla, vuelve sola a la anterior.

**El esquema más nuevo que el código.** Cada migración que se aplica queda anotada en el esquema
(`schema_migrations`). Una versión nunca arranca contra un esquema con migraciones que no conoce: se
queda en mantenimiento, `/health` dice `migration-failed` y el log dice
`El esquema … es más nuevo (vN) que este código (vM): ¿un rollback?`. Por eso, si la versión nueva
llegó a migrar algo, la anterior **no arranca** sobre esa base: hay que restaurar la copia previa.
`deploy.sh` lo prueba solo y avisa.

### Seguir un deploy con migraciones

Todo en la terminal de Lightsail, mientras corre el workflow.

- [ ] **Ver el log en vivo.**

  ```bash
  sudo journalctl -u mini-erp -f
  ```

  Se tiene que ver `en mantenimiento hasta terminar las migraciones`, una línea
  `[migraciones] PostgreSQL <esquema>: v<N> <nombre>` por esquema que migró (`system` y cada
  `tenant_<id>`) y el banner `Servidor iniciado`. `Ctrl+C` para salir.
- [ ] **Confirmar que quedó lista** (en otra pestaña, o después de salir del log).

  ```bash
  curl -s https://mini.contax.ar/health
  ```

  Tiene que responder `{"status":"ok","service":"mini-erp","version":"<la nueva>"}`.
- [ ] **Confirmar la copia previa.**

  ```bash
  sudo ls -lt /var/lib/mini-erp-backups | head -n 3
  ```

  Arriba tiene que estar un `minierp-<fecha>T<hora>Z.dump` de la hora del deploy (en UTC), el mismo
  que dice `Copia previa:` en el log del workflow.

### Si el deploy falla

- [ ] **Ver qué dijo el workflow** (GitHub → Actions → el deploy en rojo → el paso que sube la
  versión) **y el log del servidor.**

  ```bash
  sudo journalctl -u mini-erp -n 100 --no-pager | grep -E 'migraciones|esquema'
  ```

  | Si dice | Qué pasó | Qué hacer |
  |---|---|---|
  | `La copia previa falló: no activo …` | El backup no pudo escribir el dump. La versión nueva no se activó: todo sigue como estaba | Ver el log del backup (`sudo journalctl -u mini-erp-backup.service -n 30 --no-pager`; casi siempre es disco lleno: `df -h /var/lib`) y volver a correr el deploy |
  | `[migraciones] FALLÓ PostgreSQL: migración v<N> <nombre> en <esquema>: …` y en el workflow `<versión> atiende de nuevo` | Una migración falló antes de cambiar algo (se deshizo) y el deploy volvió a la versión anterior, que anda | Arreglar la migración en el repo y publicar otra versión (`patch`) |
  | Lo mismo, pero el workflow dice `tampoco quedó lista` | La migración que falló se deshizo, pero otras ya habían migrado: la versión anterior no arranca sobre un esquema más nuevo | [Restaurar la copia previa](#restaurar-un-backup) que nombra el workflow y reiniciar; después, arreglar y publicar un `patch` |
  | `[migraciones] FALLÓ el arranque: El esquema … es más nuevo (vN) que este código` | La versión que corre es más vieja que la base | Publicar la versión que la migró o restaurar la copia previa |
  | Nada de `[migraciones]`, y el workflow dice "La migración sigue corriendo" | La migración tarda más de 15 minutos. El deploy **no** volvió atrás, a propósito | Seguir el log (`sudo journalctl -u mini-erp -f`) hasta que diga `Servidor iniciado` o `FALLÓ` |

- [ ] **Confirmar qué versión responde.**

  ```bash
  curl -s https://mini.contax.ar/health
  ```

  Después de una vuelta atrás tiene que dar `"status":"ok"` con la versión anterior. Si da
  `migration-failed`, falta restaurar la copia previa.

### Volver a una versión anterior a mano

Solo si una versión **ya migró y atendió** y hay que deshacerla. **Se pierde lo que se escribió
después de la copia previa** (ventas sincronizadas, cambios en el admin): la base vuelve a esa copia.
La versión anterior no arranca sobre un esquema más nuevo, por eso hay que restaurar. Todo de a una
línea, en la terminal de Lightsail.

- [ ] **Elegir la copia previa.** La del deploy que querés deshacer: la que nombra su workflow en
  `Copia previa:`, o la última de antes de la hora del deploy (los nombres van en UTC).

  ```bash
  sudo ls -lt /var/lib/mini-erp-backups
  ```

- [ ] **Elegir la versión anterior.**

  ```bash
  ls -1dt /opt/mini-erp/releases/*/
  ```

  La primera es la activa; la segunda es la anterior. Anotá su carpeta.
- [ ] **Parar el mini-erp, restaurar y volver el enlace**: los pasos de
  [Sobre la base de la instancia](#sobre-la-base-de-la-instancia), con este cambio antes de arrancar
  (reemplazá `<carpeta-anterior>`):

  ```bash
  sudo -u deploy ln -sfn <carpeta-anterior> /opt/mini-erp/current
  ```

  `readlink /opt/mini-erp/current` tiene que mostrar esa carpeta. Después, `sudo systemctl start
  mini-erp` y el `curl` de `/health`, que tiene que responder la versión anterior.

## Backups

- **Qué**: un `pg_dump` de la base entera en formato propio de PostgreSQL (`-Fc`), sin los esquemas
  de los comercios demo (se vuelven a sembrar solos). Las filas de sistema de las demos sí van.
- **Cuándo**: cada noche a las 03:30 UTC (`mini-erp-backup.timer`; si la instancia estaba apagada,
  al prender) y antes de activar cada versión (la copia previa del deploy).
- **Dónde**: `/var/lib/mini-erp-backups`, un archivo por corrida:
  `minierp-AAAA-MM-DDTHH-MM-SSZ.dump` (UTC). Se escribe como `.tmp` y se renombra al terminar: un
  `.dump` siempre está completo.
- **Cuánto**: 7 días, por la fecha del nombre. Lo viejo se borra solo después de un dump bueno: si
  el backup falla, no se pierde nada. Otros archivos de la carpeta no se tocan.
- **Quién**: solo `minierp` los puede leer (tienen hashes de contraseñas). Por eso todo va con `sudo`.

Para listarlos y ver qué tiene uno:

```bash
sudo ls -lh /var/lib/mini-erp-backups
```

```bash
sudo -u minierp pg_restore --list /var/lib/mini-erp-backups/minierp-2026-11-20T03-30-00Z.dump | head -n 30
```

Para correr uno a mano (por ejemplo, antes de tocar algo): `sudo systemctl start
mini-erp-backup.service`. Termina cuando el dump está escrito; el log lo confirma con
`[backup] /var/lib/mini-erp-backups/minierp-….dump: N B, 3 esquemas demo excluidos`.

### Copiar un backup fuera del servidor

Los snapshots de Lightsail cubren la instancia entera, pero conviene tener de vez en cuando un dump
en otro lado. **Nunca en GitHub** (ni artifacts ni el repo): en un repo público lo baja cualquiera.

1. En la terminal de Lightsail, dejá una copia en la carpeta de `ubuntu` (reemplazá el nombre):

   ```bash
   sudo install -m 600 -o ubuntu -g ubuntu /var/lib/mini-erp-backups/minierp-2026-11-20T03-30-00Z.dump /home/ubuntu/
   ```

2. En Lightsail → **Account** → **SSH keys**, bajá la llave por defecto de la región de la instancia
   (un `.pem`).
3. En PowerShell, bajá el archivo (reemplazá la llave, la `<IP>` y el nombre):

   ```powershell
   scp -i $HOME\Downloads\LightsailDefaultKey-us-east-1.pem ubuntu@<IP>:minierp-2026-11-20T03-30-00Z.dump $HOME\
   ```

4. De vuelta en la terminal de Lightsail, borrá la copia: `rm /home/ubuntu/minierp-*.dump`.

Guardalo en un lugar privado (un disco o una carpeta personal en la nube, no compartida).

## Restaurar un backup

Hay dos maneras. Las dos corren como `minierp`, que es dueño de la base, con un `.dump` de
`/var/lib/mini-erp-backups`. `--exit-on-error` hace que se frene en el primer error en lugar de
dejar una base a medias sin avisar.

### Sobre la base de la instancia

Para volver la base a un momento (deshacer un deploy, un error grave). **Se pierde todo lo que se
escribió después de ese backup.** Con el servicio detenido, de a una línea:

- [ ] **Parar el mini-erp** (desde acá el sitio queda caído; el POS sigue vendiendo).

  ```bash
  sudo systemctl stop mini-erp
  ```

  `systemctl is-active mini-erp` tiene que decir `inactive`.
- [ ] **Restaurar** (reemplazá el nombre del archivo).

  ```bash
  cd / && sudo -u minierp pg_restore --clean --if-exists --exit-on-error --no-owner --dbname=minierp /var/lib/mini-erp-backups/minierp-2026-11-20T03-30-00Z.dump
  ```

  `--clean --if-exists` borra antes lo que trae el dump y lo vuelve a crear. No tiene que imprimir
  nada. Los esquemas de las demos no están en el dump: quedan como estaban.
- [ ] **Arrancar y comprobar.**

  ```bash
  sudo systemctl start mini-erp
  ```

  ```bash
  curl -s https://mini.contax.ar/health
  ```

  Tiene que responder `"status":"ok"` (unos segundos de `"status":"maintenance"` son normales).
  Para dejar las demos en orden, un reinicio total desde Plataforma → Demos.

### En una base nueva

Para mirar un backup sin tocar producción, o para cargar los datos en un servidor nuevo antes de su
primer deploy (ahí la base `minierp` que crea `provision.sh` está vacía: se restaura directo en ella,
salteando el primer paso).

- [ ] **Crear la base** (como `postgres`, porque `minierp` no puede crear bases).

  ```bash
  cd / && sudo -u postgres psql -c "CREATE DATABASE minierp_prueba OWNER minierp TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'"
  ```

- [ ] **Restaurar.**

  ```bash
  cd / && sudo -u minierp pg_restore --exit-on-error --no-owner --dbname=minierp_prueba /var/lib/mini-erp-backups/minierp-2026-11-20T03-30-00Z.dump
  ```

- [ ] **Mirarla** (`cd / && sudo -u minierp psql minierp_prueba`) y, al terminar, borrarla:
  `cd / && sudo -u postgres dropdb minierp_prueba`.

**Las demos quedan vacías.** En una base restaurada están las filas de `system.demo_tenants` pero no
los esquemas de las demos (el backup no los trae): el mini-erp arranca con los comercios demo sin
catálogo ni ventas. Se arregla de dos maneras:

- **Antes de arrancar** el mini-erp sobre esa base, que el barrido del arranque haga el reinicio
  total:

  ```bash
  cd / && sudo -u minierp psql minierp -c "UPDATE system.demo_tenants SET last_full_reset_at = '2000-01-01T00:00:00.000Z'"
  ```

- **Después**: el reinicio total de cada comercio demo desde Plataforma → Demos.

### La instancia entera, desde un snapshot

Si se rompió o se borró: en Lightsail, pestaña **Snapshots** → el snapshot → **Create new
instance** (mismo plan de US$5). Cuando esté en "Running":

1. En su pestaña **Storage**, confirmá que tenga el disco de PostgreSQL. Si no, creá un disco desde
   el snapshot del disco (pestaña **Snapshots** del disco) y adjuntalo. Como el disco ya tiene datos,
   del [paso 2c](#paso-2c-el-disco-de-postgresql) se hacen el montaje y el `fstab`, **nunca el
   `mkfs`**.
2. En la pestaña **Networking** de la cuenta, pasá la IP estática a la instancia nueva. Como la IP
   es la misma, el nombre `<HOST>` y los secretos de GitHub siguen sirviendo.
3. Borrá la instancia vieja si todavía existe (y su disco, si quedó suelto).

Un snapshot es una foto del disco con PostgreSQL andando: al arrancar, PostgreSQL se recupera como
después de un corte de luz. Si no arranca, la salida es una instancia nueva con su disco vacío y el
último `pg_dump` ([En una base nueva](#en-una-base-nueva)).

### El disco ya tiene un cluster

`provision.sh` se frena con `ya tiene un cluster pero esta instancia no lo conoce` si el disco viene
de otra instancia (por ejemplo, uno nuevo creado desde un snapshot del disco, adjuntado a una
instancia recién creada). No lo toca para no borrar datos. Lo más simple: apartar ese cluster,
volver a correr `provision.sh` (crea uno vacío) y restaurar el último `pg_dump` como en
[En una base nueva](#en-una-base-nueva).

```bash
sudo mv /mnt/pgdata/16 /mnt/pgdata/16-de-otra-instancia
```

Cuando la base restaurada ande, se borra lo apartado: `sudo rm -r /mnt/pgdata/16-de-otra-instancia`.

## Pasar a PostgreSQL (una sola vez)

Hasta la 0.17.0 el mini-erp guardaba todo en archivos SQLite en `/var/lib/mini-erp`. Desde la 0.18.0
usa PostgreSQL, y **arranca vacío**: los datos de SQLite no se importan (en producción no había
comercios reales). Lo de antes queda en el servidor, sin tocar:

- las bases `.sqlite`, en `/var/lib/mini-erp`;
- los backups de SQLite (carpetas por fecha), en `/var/lib/mini-erp-backups`. La retención nueva
  solo borra sus `minierp-*.dump`: esas carpetas quedan hasta que las borres.

Las cajas que estaban conectadas a producción quedan con una key que ya no existe (`401`): se vuelven
a conectar con un comercio nuevo.

El orden importa: el PR se mergea **sin crear el tag** (el tag dispara el deploy, y la 0.18.0 no
arranca sin PostgreSQL). Todo en la terminal de Lightsail salvo donde se dice.

- [ ] **El disco.** Hacé el [paso 2c](#paso-2c-el-disco-de-postgresql) (crear, adjuntar y montar
  `/mnt/pgdata`).
- [ ] **Un último backup de SQLite.** Parar el mini-erp (desde acá lo que llegue no se guarda en
  ningún lado) y correr el backup de la versión vieja:

  ```bash
  sudo systemctl stop mini-erp
  ```

  ```bash
  sudo systemctl start mini-erp-backup.service
  ```

  ```bash
  sudo ls -lt /var/lib/mini-erp-backups
  ```

  Arriba tiene que estar la carpeta de hoy.
- [ ] **Provisión.** Con la guía al día (`rm -rf /tmp/mini-erp` y el `git clone` del paso 4, ya con
  `main`), correr `provision.sh` como en el paso 4, con el mismo `<HOST>`, la misma clave pública y
  los mismos sinónimos. Instala PostgreSQL 16, crea el cluster en el disco, la base `minierp` y el
  rol, agrega `DATABASE_URL` a `/etc/mini-erp/env` (dice `Agregué DATABASE_URL a /etc/mini-erp/env`)
  y pone las units nuevas. Tiene que terminar con:

  ```
  PostgreSQL 16.x con los datos en /mnt/pgdata/16/main, base minierp por el socket (peer)
  ```

  Al final reinicia el mini-erp, que todavía es el de SQLite: con la unit nueva ya no puede escribir
  `/var/lib/mini-erp` y no anda. Es esperado: el sitio queda caído hasta el deploy.
- [ ] **El deploy.** En tu Windows, `pnpm release:tag` desde `main` ([paso 6](#paso-6-publicar-una-versión)).
  El workflow dice `La versión activa es anterior a PostgreSQL: sin copia previa`; la 0.18.0 arranca,
  ve la base vacía y la migra sola (el esquema `system` y los comercios demo, que siembra).
- [ ] **El root.** Como en el [paso 7](#paso-7-crear-el-root-una-sola-vez):

  ```bash
  sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
  ```

- [ ] **Comprobar.** `curl -s https://mini.contax.ar/health` tiene que dar `"status":"ok"` con
  `"version":"0.18.0"`, y en `https://mini.contax.ar/admin` tenés que poder entrar con el root. "Probar
  la demo" en el landing tiene que abrir el POS con la caja de demo.
- [ ] **`DATA_DIR`.** Si `/etc/mini-erp/env` todavía tiene `DATA_DIR=/var/lib/mini-erp`, el código
  nuevo lo ignora. Dejalo mientras quieras poder volver atrás (la versión de SQLite lo usa); después
  se borra la línea (`sudo nano /etc/mini-erp/env`), sin reiniciar nada.

### Volver a SQLite durante la transición

Si la 0.18.0 no anda y hay que volver a la 0.17.0 mientras tanto. La versión de SQLite necesita
escribir `/var/lib/mini-erp`, y la unit nueva no se lo permite: se le devuelve el permiso con un
agregado (un "drop-in") que no toca la unit. Que la unit nueva pida PostgreSQL no molesta: queda
andando.

- [ ] **Devolverle el permiso de escritura.**

  ```bash
  sudo systemctl edit mini-erp
  ```

  Se abre un editor: en el lugar que indica (entre los comentarios de arriba y los de abajo), escribí

  ```ini
  [Service]
  ReadWritePaths=/var/lib/mini-erp /var/lib/mini-erp-backups
  ```

  y guardá (`Ctrl+O`, Enter, `Ctrl+X`).
- [ ] **Volver el enlace a la 0.17.0**: la segunda carpeta de `ls -1dt /opt/mini-erp/releases/*/`.

  ```bash
  sudo -u deploy ln -sfn <carpeta-anterior> /opt/mini-erp/current
  ```

- [ ] **Arrancar y comprobar.** `sudo systemctl restart mini-erp` y
  `curl -s https://mini.contax.ar/health`, que tiene que responder la `0.17.0`. Necesita `DATA_DIR`
  en `/etc/mini-erp/env`. Las `.sqlite` están como antes de parar; lo que se escribió en PostgreSQL
  mientras tanto no pasa a SQLite.

Para volver a intentar con PostgreSQL: borrar el agregado (`sudo rm
/etc/systemd/system/mini-erp.service.d/override.conf` y `sudo systemctl daemon-reload`) y correr el
deploy de nuevo (Actions → **Deploy** → **Run workflow**). La base de PostgreSQL sigue ahí, con lo que
ya tenía.

## Dar de baja

1. Lightsail → la instancia → menú ⋮ → **Delete**.
2. Menú **Storage** de la cuenta → el disco `mini-erp-pgdata` → **Delete** (si quedó adjuntado,
   primero **Detach**). Suelto también cobra.
3. Pestaña **Networking** de la cuenta → la IP estática → **Delete** (suelta cobra).
4. Pestaña **Snapshots** → borrar los snapshots que queden (los de la instancia y los del disco).
5. GitHub → Settings → Environments → `production` → **Delete environment**.

Antes de borrar, si querés conservar los datos, [copiá un backup fuera del
servidor](#copiar-un-backup-fuera-del-servidor).
