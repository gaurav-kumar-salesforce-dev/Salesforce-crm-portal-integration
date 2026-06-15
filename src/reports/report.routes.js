const express = require('express');
const reportService = require('./report.service');

function createReportsRouter({ checkAuth, deps }) {
  const router = express.Router();
  router.use(checkAuth);

  router.get('/metadata/objects', asyncHandler(async (req, res) => {
    res.json({ objects: await reportService.metadata(req.user, deps) });
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

  router.post('/:id/run', asyncHandler(async (req, res) => {
    res.json(await reportService.runReport(req.params.id, req.user, deps, req.body || {}));
  }));

  router.get('/:id/export.csv', asyncHandler(async (req, res) => {
    const file = await reportService.exportReportCsv(req.params.id, req.user, deps);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.csv);
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
