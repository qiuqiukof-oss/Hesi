// ============================================================
// Browser route group: accessibility analysis.
// Handler copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const { buildResponse } = require('./helpers');

function createA11yRouter() {
  const router = express.Router();

  /**
   * 运行可访问性分析
   */
  router.post('/browser/accessibility', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();
      const state = await browserManager.getPageState(page);

      const a11yResult = await page.evaluate(() => {
        const issues = [];

        // 1. 检查页面标题
        if (!document.title || document.title.trim() === '') {
          issues.push({ type: 'error', category: 'page', code: 'missing-title',
            message: '页面缺少 <title> 标签', severity: 'high' });
        }

        // 2. 检查 HTML lang 属性
        const html = document.documentElement;
        const lang = html.getAttribute('lang');
        if (!lang) {
          issues.push({ type: 'error', category: 'page', code: 'missing-lang',
            message: '<html> 标签缺少 lang 属性', severity: 'high' });
        }

        // 3. 检查图片 alt 文本
        const images = document.querySelectorAll('img:not([alt]), img[alt=""]');
        for (const img of images) {
          if (img.getAttribute('role') === 'presentation') continue;
          issues.push({ type: 'error', category: 'image', code: 'missing-alt',
            message: `图片缺少 alt 文本: ${img.getAttribute('src')?.slice(0, 80) || 'unknown'}`,
            severity: 'high', selector: getSimpleSelector(img) });
        }

        // 4. 检查表单标签关联
        const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])');
        for (const input of inputs) {
          const id = input.id;
          const hasLabel = id && document.querySelector(`label[for="${id}"]`);
          const hasAriaLabel = input.hasAttribute('aria-label') && input.getAttribute('aria-label').trim();
          const hasAriaLabelledBy = input.hasAttribute('aria-labelledby');
          const isInsideLabel = input.closest('label');

          if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !isInsideLabel) {
            issues.push({ type: 'warning', category: 'form', code: 'unlabeled-input',
              message: `输入框缺少关联 label: ${getSimpleSelector(input)}`,
              severity: 'medium', selector: getSimpleSelector(input) });
          }
        }

        // 5. 检查 heading 层级
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let prevLevel = 0;
        for (const h of headings) {
          const level = parseInt(h.tagName[1], 10);
          if (level - prevLevel > 1 && prevLevel > 0) {
            issues.push({ type: 'warning', category: 'heading', code: 'heading-skip',
              message: `标题层级跳跃: 从 h${prevLevel} 到 h${level} (${h.textContent?.trim()?.slice(0, 50) || ''})`,
              severity: 'medium', selector: getSimpleSelector(h) });
          }
          prevLevel = level;
        }

        // 6. 检查文档只有一个 h1
        const h1Count = document.querySelectorAll('h1').length;
        if (h1Count === 0) {
          issues.push({ type: 'warning', category: 'heading', code: 'missing-h1',
            message: '页面缺少 h1 标题', severity: 'medium' });
        } else if (h1Count > 1) {
          issues.push({ type: 'warning', category: 'heading', code: 'multiple-h1',
            message: `页面有 ${h1Count} 个 h1 标题（建议只有 1 个）`, severity: 'low' });
        }

        // 7. 检查 focusable 元素的 tabindex
        const positiveTabIndex = document.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])');
        for (const el of positiveTabIndex) {
          const ti = parseInt(el.getAttribute('tabindex'), 10);
          if (ti > 0) {
            issues.push({ type: 'warning', category: 'keyboard', code: 'positive-tabindex',
              message: `元素使用了正数 tabindex (${ti})，可能导致键盘导航混乱: ${getSimpleSelector(el)}`,
              severity: 'low', selector: getSimpleSelector(el) });
          }
        }

        // 8. 检查颜色对比度（仅提示，精确计算需要浏览器支持）
        // 简化检查：检测文本元素是否设置了颜色
        const styledText = document.querySelectorAll('[style*="color:"]');
        if (styledText.length > 10) {
          issues.push({ type: 'info', category: 'contrast', code: 'custom-colors',
            message: `页面有 ${styledText.length} 个元素自定义了文本颜色，建议检查颜色对比度`,
            severity: 'info' });
        }

        // 9. 检查 ARIA 角色使用
        const ariaRoles = document.querySelectorAll('[role]');
        const validRoles = ['button', 'link', 'navigation', 'main', 'complementary', 'banner',
          'contentinfo', 'search', 'form', 'dialog', 'alert', 'status', 'tab', 'tabpanel', 'tablist',
          'listbox', 'option', 'combobox', 'textbox', 'progressbar', 'slider', 'switch'];
        for (const el of ariaRoles) {
          const role = el.getAttribute('role');
          if (role && !validRoles.includes(role)) {
            issues.push({ type: 'info', category: 'aria', code: 'unknown-role',
              message: `使用了非标准 ARIA role: "${role}" (${getSimpleSelector(el)})`,
              severity: 'info', selector: getSimpleSelector(el) });
          }
        }

        // 10. 检查可点击元素是否可聚焦
        const clickables = document.querySelectorAll('[onclick], [onmousedown], .clickable');
        for (const el of clickables) {
          const tag = el.tagName.toLowerCase();
          if (!['a', 'button', 'input'].includes(tag) &&
              !el.hasAttribute('tabindex') &&
              !el.hasAttribute('role')) {
            issues.push({ type: 'info', category: 'keyboard', code: 'non-focusable-click',
              message: `可点击元素无法通过键盘聚焦: ${getSimpleSelector(el)}`,
              severity: 'info', selector: getSimpleSelector(el) });
          }
        }

        // 辅助函数：生成简单 CSS 选择器
        function getSimpleSelector(el) {
          if (el.id) return `#${  CSS.escape(el.id)}`;
          const tag = el.tagName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(/\s+/).slice(0, 2).map(c => `.${  CSS.escape(c)}`).join('');
            return tag + classes;
          }
          return tag;
        }

        // 统计
        const stats = { error: 0, warning: 0, info: 0 };
        for (const issue of issues) {
          if (stats[issue.type] !== undefined) stats[issue.type]++;
        }

        return { issues, stats, score: calculateScore(issues) };

        function calculateScore(issues) {
          let score = 100;
          for (const issue of issues) {
            if (issue.severity === 'high') score -= 10;
            else if (issue.severity === 'medium') score -= 5;
            else if (issue.severity === 'low') score -= 2;
          }
          return Math.max(0, score);
        }
      }).catch(() => ({ issues: [], stats: { error: 0, warning: 0, info: 0 }, score: 100 }));

      res.json({
        success: true,
        ...state,
        ...a11yResult,
        issueCount: a11yResult.issues.length,
        url: state.url,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createA11yRouter;
