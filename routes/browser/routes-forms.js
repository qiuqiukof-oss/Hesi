// ============================================================
// Browser route group: form detection + auto-fill.
// Handlers copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const { buildResponse, captureBeforeAction } = require('./helpers');

function createFormsRouter() {
  const router = express.Router();

  /**
   * 检测当前页面上的表单字段
   */
  router.post('/browser/detect-forms', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();
      const state = await browserManager.getPageState(page);

      const formData = await page.evaluate(() => {
        const forms = document.querySelectorAll('form');
        const result = [];

        for (const form of forms) {
          const fields = [];
          const formInfo = {
            id: form.id || undefined,
            name: form.name || undefined,
            action: form.action || undefined,
            method: (form.method || 'get').toUpperCase(),
            fields,
            fieldCount: 0,
          };

          // 收集所有输入元素
          const elements = form.querySelectorAll('input, select, textarea');
          for (const el of elements) {
            const input = /** @type {HTMLInputElement} */ (el);
            const type = input.type || 'text';

            // 跳过隐藏/提交/按钮类型
            if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

            const field = {
              tag: el.tagName.toLowerCase(),
              type,
              name: input.name || undefined,
              id: input.id || undefined,
              placeholder: input.placeholder || undefined,
              label: '',
              required: input.required || false,
              disabled: input.disabled || false,
              value: input.value || undefined,
              autocomplete: input.autocomplete || undefined,
              maxLength: input.maxLength > 0 ? input.maxLength : undefined,
              patterns: input.pattern || undefined,
            };

            // 尝试找到关联的 label
            if (input.id) {
              const label = document.querySelector(`label[for="${input.id}"]`);
              if (label) field.label = label.textContent?.trim() || '';
            }
            if (!field.label) {
              const parent = input.closest('label');
              if (parent) {
                const labelText = parent.textContent?.trim() || '';
                // 排除输入自身的值
                const inputClone = parent.querySelector('input, select, textarea');
                if (inputClone) {
                  field.label = labelText.replace(inputClone.value || '', '').trim();
                } else {
                  field.label = labelText;
                }
              }
            }
            // 尝试通过 aria-label 获取
            if (!field.label) {
              field.label = input.getAttribute('aria-label') || '';
            }

            // select 元素：收集选项
            if (el.tagName === 'SELECT') {
              const select = /** @type {HTMLSelectElement} */ (el);
              field.options = Array.from(select.options).map(o => ({
                value: o.value,
                text: o.text,
                selected: o.selected,
              }));
              field.multiple = select.multiple || false;
            }

            fields.push(field);
          }

          formInfo.fieldCount = fields.length;
          if (fields.length > 0) result.push(formInfo);
        }

        return result;
      }).catch(() => []);

      res.json({
        success: true,
        ...state,
        forms: formData,
        formCount: formData.length,
        totalFields: formData.reduce((s, f) => s + f.fieldCount, 0),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 自动填充表单字段
   */
  router.post('/browser/fill-forms', async (req, res) => {
    try {
      const { fields } = req.body;
      // fields: [{ selector?, name?, id?, value }]

      if (!fields || !Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ success: false, error: 'fields 数组必填' });
      }

      const page = await browserManager.getActivePage();
      const state = await browserManager.getPageState(page);
      const before = await captureBeforeAction(page);

      const results = [];
      let filledCount = 0;

      for (const field of fields) {
        try {
          let locator = null;

          // 按 selector → name → id 优先级定位
          if (field.selector) {
            locator = page.locator(field.selector).first();
          } else if (field.name) {
            locator = page.locator(`[name="${field.name.replace(/"/g, '\\"')}"]`).first();
          } else if (field.id) {
            locator = page.locator(`#${CSS.escape(field.id)}`).first();
          }

          if (!locator) {
            results.push({ field, error: '无法定位元素', success: false });
            continue;
          }

          await locator.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
          const tagName = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => 'input');

          if (tagName === 'select') {
            // 下拉框：选择值
            await locator.selectOption(field.value);
          } else if (tagName === 'textarea' || field.type === 'textarea') {
            // 文本域
            await locator.fill(String(field.value));
          } else if (field.type === 'checkbox' || field.type === 'radio') {
            // 复选框/单选
            const check = field.value === true || field.value === 'true' || field.value === 'checked';
            if (check) {
              await locator.check();
            } else {
              await locator.uncheck();
            }
          } else if (field.type === 'file') {
            // 文件上传
            if (field.filePath) {
              await locator.setInputFiles(field.filePath);
            }
          } else {
            // 普通输入
            if (field.clear !== false) {
              await locator.clear();
            }
            await locator.fill(String(field.value));
          }

          filledCount++;
          results.push({ field, success: true });
        } catch (err) {
          results.push({ field, error: err.message, success: false });
        }
      }

      res.json({
        success: true,
        ...state,
        attempted: fields.length,
        filled: filledCount,
        failed: fields.length - filledCount,
        results,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createFormsRouter;
