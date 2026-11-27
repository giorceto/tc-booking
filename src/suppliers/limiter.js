// Ограничава заявките към оператор до N на минута (плъзгащ се прозорец).
// perMin = 0 -> без ограничение.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Limiter {
  constructor(perMin) {
    this.perMin = perMin;
    this.times = []; // кога са тръгнали заявките през последната минута
    this.pending = 0; // чакащи в опашката (още не са тръгнали)
    this.chain = Promise.resolve();
  }

  prune() {
    const now = Date.now();
    this.times = this.times.filter((t) => now - t < 60000);
    return now;
  }

  status() {
    this.prune();
    return { perMin: this.perMin, usedLastMinute: this.times.length, waiting: this.pending };
  }

  // Приблизително след колко ms би тръгнала нова заявка (0 = веднага)
  waitMs() {
    if (!this.perMin) return 0;
    const now = this.prune();
    const ahead = this.times.length + this.pending; // заети места + чакащите пред нас
    if (ahead < this.perMin) return 0;
    const over = ahead - this.perMin; // колко освобождавания трябва да изчакаме
    const rounds = Math.floor(over / this.perMin);
    const t = this.times[over % this.perMin] ?? this.times[0] ?? now;
    return Math.max(0, 60000 - (now - t)) + rounds * 60000;
  }

  schedule(fn) {
    if (!this.perMin) return fn();
    this.pending++;
    const run = async () => {
      for (;;) {
        const now = this.prune();
        if (this.times.length < this.perMin) break;
        await sleep(60000 - (now - this.times[0]) + 100);
      }
      this.pending--;
      this.times.push(Date.now());
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

module.exports = Limiter;
