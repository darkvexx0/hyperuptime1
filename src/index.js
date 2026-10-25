require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const { DISCORD_TOKEN: TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const DB_PATH = path.join(__dirname, "..", "database.json");
const INTERVAL = 3 * 60 * 1000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Eksik ortam değişkeni: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { urls: {} }; }
}
function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

const commands = [
  new SlashCommandBuilder().setName("uptimeekle").setDescription("İzlenecek web adresi ekle")
    .addStringOption(o => o.setName("url").setDescription("https:// ile başlayan adres").setRequired(true)),
  new SlashCommandBuilder().setName("uptimeler").setDescription("İzlenen adresleri listele"),
  new SlashCommandBuilder().setName("uptimesil").setDescription("İzlenen adresi sil")
    .addStringOption(o => o.setName("url").setDescription("Silinecek adres").setRequired(true))
];
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function checkUrl(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal,
      headers: { "User-Agent": "HyperUptime/1.0" } });
    return { ok: response.status >= 200 && response.status < 400, status: response.status,
      ms: Date.now() - started, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "Zaman aşımı" : e.message,
      ms: Date.now() - started, checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}
async function runChecks() {
  const db = readDb();
  for (const entries of Object.values(db.urls || {})) {
    for (const item of entries) {
      item.lastCheck = await checkUrl(item.url);
      console.log(`[UPTIME] ${item.url}: ${item.lastCheck.ok ? "UP" : "DOWN"}`);
    }
  }
  writeDb(db);
}
client.once("ready", async () => {
  console.log(`Giriş yapıldı: ${client.user.tag}`);
  try {
    await new REST({ version: "10" }).setToken(TOKEN).put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(c => c.toJSON()) });
    console.log("Slash komutları kaydedildi.");
  } catch (e) { console.error("Komut kaydı başarısız:", e); }
  runChecks().catch(console.error);
  setInterval(() => runChecks().catch(console.error), INTERVAL);
});
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  if (!i.guildId) return i.reply({ content: "Bu komutları sunucuda kullan.", ephemeral: true });
  const db = readDb(); db.urls[i.guildId] ||= [];
  if (i.commandName === "uptimeekle") {
    const raw = i.options.getString("url", true).trim();
    let url;
    try { url = new URL(raw); if (!["http:", "https:"].includes(url.protocol)) throw Error(); }
    catch { return i.reply({ content: "Geçerli bir http:// veya https:// adresi gir.", ephemeral: true }); }
    if (db.urls[i.guildId].some(x => x.url === url.href))
      return i.reply({ content: "Bu adres zaten izleniyor.", ephemeral: true });
    db.urls[i.guildId].push({ url: url.href, addedAt: new Date().toISOString(), lastCheck: null });
    writeDb(db); return i.reply(`✅ İzleme listesine eklendi: ${url.href}`);
  }
  if (i.commandName === "uptimeler") {
    const list = db.urls[i.guildId];
    if (!list.length) return i.reply({ content: "Liste boş. /uptimeekle ile adres ekle.", ephemeral: true });
    const embed = new EmbedBuilder().setTitle("Hyper Uptime").setColor(0x5865f2)
      .setDescription(list.map((x, n) => {
        const r = x.lastCheck;
        return `**${n+1}.** ${x.url}\n${!r ? "⏳ Kontrol bekleniyor" :
          r.ok ? `🟢 Çalışıyor · HTTP ${r.status} · ${r.ms} ms` : `🔴 Ulaşılamıyor · ${r.status ?? r.error}`}`;
      }).join("\n\n"));
    return i.reply({ embeds: [embed], ephemeral: true });
  }
  if (i.commandName === "uptimesil") {
    const raw = i.options.getString("url", true).trim();
    const n = db.urls[i.guildId].findIndex(x => x.url === raw);
    if (n < 0) return i.reply({ content: "Adres bulunamadı. /uptimeler ile kontrol et.", ephemeral: true });
    db.urls[i.guildId].splice(n, 1); writeDb(db);
    return i.reply(`🗑️ Silindi: ${raw}`);
  }
});
process.on("unhandledRejection", e => console.error("Unhandled rejection:", e));
client.login(TOKEN);
