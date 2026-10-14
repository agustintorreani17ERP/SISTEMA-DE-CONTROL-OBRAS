import { prisma } from "../../src/lib/prisma";
(async () => {
  const p = await prisma.project.findMany({ select: { id: true, code: true, name: true } });
  for (const x of p) {
    const [wf, lp, sub, lin] = await Promise.all([
      prisma.workFront.count({ where: { projectId: x.id } }),
      prisma.laborPrice.count({ where: { projectId: x.id } }),
      prisma.certification.count({ where: { projectId: x.id, NOT: { partnerId: null } } }),
      prisma.subPlanillaLinea.count({ where: { projectId: x.id } }),
    ]);
    console.log(x.id, x.code, "|", x.name, "| frentes", wf, "listaMO", lp, "certsSub", sub, "lineas", lin);
  }
})().finally(() => prisma.$disconnect());
