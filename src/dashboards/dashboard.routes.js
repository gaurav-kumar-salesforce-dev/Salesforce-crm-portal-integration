const express = require('express');
const dashboardService = require('./dashboard.service');

function createDashboardsRouter({ checkAuth, deps }) {
  const router = express.Router();
  router.use(checkAuth);

  router.get('/folders', asyncHandler(async (req, res) => {
    res.json({ folders: await dashboardService.listFolders(req.user) });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ dashboards: await dashboardService.listDashboards(req.user, req.query) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json({ dashboard: await dashboardService.createDashboard(req.user, req.body || {}) });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json({ dashboard: await dashboardService.getDashboard(req.params.id, req.user) });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json({ dashboard: await dashboardService.updateDashboard(req.params.id, req.user, req.body || {}) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await dashboardService.deleteDashboard(req.params.id, req.user);
    res.json({ ok: true });
  }));

  router.post('/:id/favorite', asyncHandler(async (req, res) => {
    res.json(await dashboardService.setFavorite(req.params.id, req.user, true));
  }));

  router.delete('/:id/favorite', asyncHandler(async (req, res) => {
    res.json(await dashboardService.setFavorite(req.params.id, req.user, false));
  }));

  router.post('/:id/run', asyncHandler(async (req, res) => {
    res.json(await dashboardService.runDashboard(req.params.id, req.user, deps));
  }));

  router.get('/:id/components', asyncHandler(async (req, res) => {
    await dashboardService.getDashboardForUser(req.params.id, req.user);
    res.json({ components: await dashboardService.listComponents(req.params.id) });
  }));

  router.post('/:id/components', asyncHandler(async (req, res) => {
    res.status(201).json({ component: await dashboardService.addComponent(req.params.id, req.user, req.body || {}) });
  }));

  router.patch('/:id/components/:componentId', asyncHandler(async (req, res) => {
    res.json({ component: await dashboardService.updateComponent(req.params.id, req.params.componentId, req.user, req.body || {}) });
  }));

  router.delete('/:id/components/:componentId', asyncHandler(async (req, res) => {
    await dashboardService.deleteComponent(req.params.id, req.params.componentId, req.user);
    res.json({ ok: true });
  }));

  router.use((err, req, res, next) => {
    if (!err) return next();
    res.status(err.statusCode || 500).json({
      error: err.message || 'Dashboard request failed'
    });
  });

  return router;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  createDashboardsRouter
};
