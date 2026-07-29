/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Digital Employees — REST API routes
//
// Provides HTTP endpoints for querying digital employee team
// status and available roles. Used by the frontend panel.
// ============================================================
const { Router } = require('express');

/**
 * Create the digital employee router.
 *
 * @param {object} deps
 * @param {object} [deps.digitalEmployeeTeam] — the DE team manager from ws-handler
 * @returns {import('express').Router}
 */
function createRouter({ digitalEmployeeTeam } = {}) {
  const router = Router();

  /**
   * GET /api/digital-employees
   * 获取数字员工团队完整状态 + 可用角色列表。
   */
  router.get('/digital-employees', (req, res) => {
    if (!digitalEmployeeTeam) {
      return res.status(503).json({ error: '数字员工系统未初始化' });
    }
    res.json({
      team: digitalEmployeeTeam.getTeamStatus(),
      availableRoles: digitalEmployeeTeam.listAvailableRoles(),
    });
  });

  /**
   * GET /api/digital-employees/roles
   * 获取所有可用角色定义及注册状态。
   */
  router.get('/digital-employees/roles', (req, res) => {
    if (!digitalEmployeeTeam) {
      return res.status(503).json({ error: '数字员工系统未初始化' });
    }
    res.json({ roles: digitalEmployeeTeam.listAvailableRoles() });
  });

  /**
   * GET /api/digital-employees/members
   * 获取所有已注册数字员工的详细信息。
   */
  router.get('/digital-employees/members', (req, res) => {
    if (!digitalEmployeeTeam) {
      return res.status(503).json({ error: '数字员工系统未初始化' });
    }
    res.json({ members: digitalEmployeeTeam.getAllMembers().map(m => m.getStatus()) });
  });

  return router;
}

module.exports = { createRouter };
