/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Finance — API router
//
// CRUD for budgets & settlements, an aggregate stats endpoint, and
// an AI-suggestion endpoint. Persistence lives in ./finance/store.js,
// suggestion heuristics in ./finance/suggestions.js.
// ============================================================
const express = require('express');

const { loadData, saveData, uid } = require('./store');
const { buildSuggestions } = require('./suggestions');

/**
 * Create the finance router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ─── BUDGETS ───

  // List
  router.get('/finance/budgets', (req, res) => {
    const data = loadData();
    const budgets = (data.budgets || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // Attach settlement amounts
    budgets.forEach(b => {
      b.settlements = (data.settlements || []).filter(s => s.budgetId === b.id);
    });
    res.json({ success: true, budgets });
  });

  // Get one
  router.get('/finance/budgets/:id', (req, res) => {
    const data = loadData();
    const budgets = data.budgets || [];
    const budget = budgets.find(b => b.id === req.params.id);
    if (!budget) return res.status(404).json({ success: false, error: 'Budget not found' });
    budget.settlements = (data.settlements || []).filter(s => s.budgetId === budget.id);
    res.json({ success: true, budget });
  });

  // Create
  router.post('/finance/budgets', (req, res) => {
    const { title, category, totalAmount, description, items } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, error: 'Title required' });
    const data = loadData();
    const budget = {
      id: uid(),
      title: title.trim(),
      category: category || 'other',
      totalAmount: totalAmount || 0,
      description: (description || '').trim(),
      items: items || [],
      status: req.body.status || 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.budgets.push(budget);
    saveData(data);
    res.json({ success: true, budget });
  });

  // Update
  router.put('/finance/budgets/:id', (req, res) => {
    const data = loadData();
    const idx = (data.budgets || []).findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Budget not found' });
    const { title, category, totalAmount, description, items, status } = req.body;
    if (title !== undefined) data.budgets[idx].title = title.trim();
    if (category !== undefined) data.budgets[idx].category = category;
    if (totalAmount !== undefined) data.budgets[idx].totalAmount = totalAmount;
    if (description !== undefined) data.budgets[idx].description = description.trim();
    if (items !== undefined) data.budgets[idx].items = items;
    if (status !== undefined) data.budgets[idx].status = status;
    data.budgets[idx].updatedAt = new Date().toISOString();
    saveData(data);
    res.json({ success: true, budget: data.budgets[idx] });
  });

  // Change status
  router.patch('/finance/budgets/:id/status', (req, res) => {
    const data = loadData();
    const idx = (data.budgets || []).findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Budget not found' });
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status required' });
    data.budgets[idx].status = status;
    data.budgets[idx].updatedAt = new Date().toISOString();
    saveData(data);
    res.json({ success: true, budget: data.budgets[idx] });
  });

  // Delete
  router.delete('/finance/budgets/:id', (req, res) => {
    const data = loadData();
    const idx = (data.budgets || []).findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Budget not found' });
    data.budgets.splice(idx, 1);
    // Also remove related settlements
    if (data.settlements) {
      data.settlements = data.settlements.filter(s => s.budgetId !== req.params.id);
    }
    saveData(data);
    res.json({ success: true });
  });

  // ─── SETTLEMENTS ───

  // List (optional ?budgetId=)
  router.get('/finance/settlements', (req, res) => {
    const data = loadData();
    let settlements = (data.settlements || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (req.query.budgetId) {
      settlements = settlements.filter(s => s.budgetId === req.query.budgetId);
    }
    res.json({ success: true, settlements });
  });

  // Create
  router.post('/finance/settlements', (req, res) => {
    const { budgetId, amount, settlementDate, payee, receipt, status, note } = req.body;
    if (!budgetId) return res.status(400).json({ success: false, error: 'budgetId required' });
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' });
    const data = loadData();
    const settlement = {
      id: uid(),
      budgetId,
      amount: Number(amount),
      settlementDate: settlementDate || new Date().toISOString().slice(0, 10),
      payee: (payee || '').trim(),
      receipt: (receipt || '').trim(),
      status: status || 'pending',
      note: (note || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.settlements.push(settlement);
    saveData(data);
    res.json({ success: true, settlement });
  });

  // Update
  router.put('/finance/settlements/:id', (req, res) => {
    const data = loadData();
    const idx = (data.settlements || []).findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Settlement not found' });
    const { budgetId, amount, settlementDate, payee, receipt, status, note } = req.body;
    if (budgetId !== undefined) data.settlements[idx].budgetId = budgetId;
    if (amount !== undefined) data.settlements[idx].amount = Number(amount);
    if (settlementDate !== undefined) data.settlements[idx].settlementDate = settlementDate;
    if (payee !== undefined) data.settlements[idx].payee = payee.trim();
    if (receipt !== undefined) data.settlements[idx].receipt = receipt.trim();
    if (status !== undefined) data.settlements[idx].status = status;
    if (note !== undefined) data.settlements[idx].note = note.trim();
    data.settlements[idx].updatedAt = new Date().toISOString();
    saveData(data);
    res.json({ success: true, settlement: data.settlements[idx] });
  });

  // Delete
  router.delete('/finance/settlements/:id', (req, res) => {
    const data = loadData();
    const idx = (data.settlements || []).findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Settlement not found' });
    data.settlements.splice(idx, 1);
    saveData(data);
    res.json({ success: true });
  });

  // ─── STATS ───
  router.get('/finance/stats', (req, res) => {
    const data = loadData();
    const budgets = data.budgets || [];
    const settlements = data.settlements || [];

    const totalBudget = budgets.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const totalSettled = settlements.reduce((sum, s) => sum + (s.amount || 0), 0);
    const budgetCount = budgets.length;

    // Budget status distribution
    const budgetStatusCount = {};
    budgets.forEach(b => { budgetStatusCount[b.status] = (budgetStatusCount[b.status] || 0) + 1; });

    // Category stats
    const categoryStats = {};
    budgets.forEach(b => {
      const cat = b.category || 'other';
      if (!categoryStats[cat]) categoryStats[cat] = { count: 0, total: 0, settled: 0 };
      categoryStats[cat].count++;
      categoryStats[cat].total += (b.totalAmount || 0);
    });
    settlements.forEach(s => {
      const b = budgets.find(b2 => b2.id === s.budgetId);
      const cat = b ? (b.category || 'other') : 'other';
      if (!categoryStats[cat]) categoryStats[cat] = { count: 0, total: 0, settled: 0 };
      categoryStats[cat].settled += (s.amount || 0);
    });

    const pendingSettlements = settlements.filter(s => s.status === 'pending' || s.status === 'partial').length;

    res.json({ success: true, stats: { totalBudget, totalSettled, budgetCount, budgetStatusCount, categoryStats, pendingSettlements } });
  });

  // ─── AI SUGGESTIONS ───
  router.post('/finance/ai-suggest', (req, res) => {
    const data = loadData();
    const suggestions = buildSuggestions(data);
    res.json({ success: true, suggestions });
  });

  return router;
}

module.exports = { createRouter };
