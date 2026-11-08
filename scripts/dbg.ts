import { q1 } from "@domma/db";
import { conversaCompleta } from "@domma/core";
import { ProvedorSimulado, ESQUEMA_RESPOSTA } from "@domma/ia";
import { montarPedido } from "../apps/workers/src/contexto.ts";
const c = await q1<any>("SELECT id FROM conversas ORDER BY criado_em LIMIT 1");
const p = await montarPedido(await conversaCompleta(c.id));
p.hist.push({ papel: "cliente", texto: "Tenho interesse na franquia, quero abrir em Uberlandia em 2 meses e tenho capital. Me manda a apresentação?" });
console.log((await new ProvedorSimulado().gerar({ sistema: p.sistema, historico: p.hist, tempoLimiteMs: 1000, esquema: ESQUEMA_RESPOSTA })).texto);
process.exit(0);
