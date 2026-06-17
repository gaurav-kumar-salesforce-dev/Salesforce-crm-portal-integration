const express = require('express');
const reportService = require('./report.service');

function createReportsRouter({ checkAuth, deps }) {
  const router = express.Router();
  router.use(checkAuth);

  router.get('/metadata/objects', asyncHandler(async (req, res) => {
    res.json({ objects: await reportService.metadata(req.user, deps) });
  }));

  router.get('/metadata/types', asyncHandler(async (req, res) => {
    res.json({ reportTypes: await reportService.listReportTypes(req.user) });
  }));

  router.post('/metadata/types', asyncHandler(async (req, res) => {
    res.status(201).json({ reportType: await reportService.createReportType(req.user, req.body || {}) });
  }));

  router.patch('/metadata/types/:typeId', asyncHandler(async (req, res) => {
    res.json({ reportType: await reportService.updateReportType(req.params.typeId, req.user, req.body || {}) });
  }));

  router.get('/metadata/types/:typeId/fields', asyncHandler(async (req, res) => {
    res.json({ fields: await reportService.fieldsForReportType(req.params.typeId, req.user, deps) });
  }));

  router.get('/metadata/:object/fields', asyncHandler(async (req, res) => {
    res.json({ fields: await reportService.fieldsForObject(req.params.object, req.user, deps) });
  }));

  router.get('/folders', asyncHandler(async (req, res) => {
    res.json({ folders: await reportService.listFolders(req.user) });
  }));

  router.post('/folders', asyncHandler(async (req, res) => {
    res.status(201).json({ folder: await reportService.createFolder(req.user, req.body || {}) });
  }));

  router.patch('/folders/:folderId', asyncHandler(async (req, res) => {
    res.json({ folder: await reportService.updateFolder(req.params.folderId, req.user, req.body || {}) });
  }));

  router.delete('/folders/:folderId', asyncHandler(async (req, res) => {
    await reportService.deleteFolder(req.params.folderId, req.user);
    res.json({ ok: true });
  }));

  router.post('/folders/:folderId/favorite', asyncHandler(async (req, res) => {
    res.json(await reportService.setFolderFavorite(req.params.folderId, req.user, true));
  }));

  router.delete('/folders/:folderId/favorite', asyncHandler(async (req, res) => {
    res.json(await reportService.setFolderFavorite(req.params.folderId, req.user, false));
  }));

  router.post('/folders/:folderId/shares', asyncHandler(async (req, res) => {
    res.status(201).json({ share: await reportService.shareFolder(req.params.folderId, req.user, req.body || {}) });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ reports: await reportService.listReports(req.user, req.query) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json({ report: await reportService.createReport(req.user, req.body || {}) });
  }));

  router.post('/preview', asyncHandler(async (req, res) => {
    res.json(await reportService.runAdhocReport(req.user, deps, req.body || {}));
  }));

  router.post('/run', asyncHandler(async (req, res) => {
    res.json(await reportService.runDraftReport(req.user, deps, req.body || {}));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json({ report: await reportService.getReportForUser(req.params.id, req.user) });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json({ report: await reportService.updateReport(req.params.id, req.user, req.body || {}) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await reportService.deleteReport(req.params.id, req.user);
    res.json({ ok: true });
  }));

  router.post('/:id/clone', asyncHandler(async (req, res) => {
    res.status(201).json({ report: await reportService.cloneReport(req.params.id, req.user) });
  }));

  router.post('/:id/favorite', asyncHandler(async (req, res) => {
    res.json(await reportService.setFavorite(req.params.id, req.user, true));
  }));

  router.delete('/:id/favorite', asyncHandler(async (req, res) => {
    res.json(await reportService.setFavorite(req.params.id, req.user, false));
  }));

  router.post('/:id/shares', asyncHandler(async (req, res) => {
    res.status(201).json({ share: await reportService.shareReport(req.params.id, req.user, req.body || {}) });
  }));

  router.post('/:id/run', asyncHandler(async (req, res) => {
    res.json(await reportService.runReport(req.params.id, req.user, deps, req.body || {}));
  }));

  router.get('/:id/export.csv', asyncHandler(async (req, res) => {
    const file = await reportService.exportReportCsv(req.params.id, req.user, deps);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.csv);
  }));

  router.get('/:id/export.xlsx', asyncHandler(async (req, res) => {
    const file = await reportService.exportReportXlsx(req.params.id, req.user, deps);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }));

  router.get('/:id/schedules', asyncHandler(async (req, res) => {
    res.json({ schedules: await reportService.listSchedules(req.params.id, req.user) });
  }));

  router.post('/:id/schedules', asyncHandler(async (req, res) => {
    res.status(201).json({ schedule: await reportService.createSchedule(req.params.id, req.user, req.body || {}) });
  }));

  router.patch('/schedules/:scheduleId', asyncHandler(async (req, res) => {
    res.json({ schedule: await reportService.updateSchedule(req.params.scheduleId, req.user, req.body || {}) });
  }));

  router.delete('/schedules/:scheduleId', asyncHandler(async (req, res) => {
    await reportService.deleteSchedule(req.params.scheduleId, req.user);
    res.json({ ok: true });
  }));

  router.post('/:id/export-jobs', asyncHandler(async (req, res) => {
    res.status(202).json({ job: await reportService.createExportJob(req.params.id, req.user, deps, req.body || {}) });
  }));

  router.get('/export-jobs/:jobId', asyncHandler(async (req, res) => {
    res.json({ job: await reportService.getExportJob(req.params.jobId, req.user) });
  }));

  router.get('/export-jobs/:jobId/download', asyncHandler(async (req, res) => {
    const job = await reportService.getExportJob(req.params.jobId, req.user);
    if (job.status !== 'completed') return res.status(409).json({ error: 'Export job is not complete yet.' });
    res.setHeader('Content-Disposition', `attachment; filename="${job.file_name || `report.${job.format}`}"`);
    if (job.format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(Buffer.from(job.result_text || '', 'base64'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(job.result_text || '');
  }));

  router.use((err, req, res, next) => {
    if (!err) return next();
    res.status(err.statusCode || 500).json({
      error: err.message || 'Report request failed'
    });
  });

  return router;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  createReportsRouter
};
