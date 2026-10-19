// Zamanlanmış görevleri ayrı bir süreçte çalıştırır (çok sunuculu dağıtımlar için).
// Kullanım: RUN_JOBS_IN_PROCESS=0 ile web sunucusunu başlatın, bu süreci ayrıca çalıştırın.
//   npm run jobs           -> dakikada bir sürekli çalışır
//   npm run jobs -- --once -> bir kez çalışır ve çıkar (cron ile kullanım için)
import { runJobsOnce } from '../server/jobs.ts';
import { closeDb } from '../server/db.ts';

if (process.argv.includes('--once')) {
  runJobsOnce()
    .then((r) => console.log(JSON.stringify(r)))
    .finally(closeDb);
} else {
  const tick = () => runJobsOnce().then((r) => console.log(new Date().toISOString(), JSON.stringify(r))).catch((e) => console.error(e));
  tick();
  setInterval(tick, 60_000);
}
