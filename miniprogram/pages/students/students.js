const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    error: "",
    children: [],
    formVisible: false,
    editingId: "",
    form: {
      name: "",
      age: "",
      grade: "",
      subjects: "",
      textbook_version: ""
    }
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const children = await api.listChildren();
      this.setData({
        children: (children || []).map((child) => ({
          ...child,
          subjectsText: (child.subjects || []).join("、") || "未设置"
        })),
        loading: false
      });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  openCreate() {
    this.setData({
      formVisible: true,
      editingId: "",
      form: { name: "", age: "", grade: "", subjects: "", textbook_version: "" }
    });
  },

  openEdit(event) {
    const child = this.data.children.find((item) => item.id === event.currentTarget.dataset.id);
    if (!child) return;
    this.setData({
      formVisible: true,
      editingId: child.id,
      form: {
        name: child.name || "",
        age: child.age === null || child.age === undefined ? "" : String(child.age),
        grade: child.grade || "",
        subjects: (child.subjects || []).join("、"),
        textbook_version: child.textbookVersion || ""
      }
    });
  },

  closeForm() {
    this.setData({ formVisible: false, editingId: "" });
  },

  noop() {},

  onField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async submit() {
    const { editingId, form } = this.data;
    if (!form.name || !form.grade) {
      wx.showToast({ title: "请填写姓名和年级", icon: "none" });
      return;
    }
    const payload = {
      name: form.name,
      age: Number(form.age || 0),
      grade: form.grade,
      subjects: form.subjects.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      textbook_version: form.textbook_version
    };
    try {
      if (editingId) {
        await api.updateChild(editingId, payload);
      } else {
        await api.createChild(payload);
      }
      this.closeForm();
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  remove(event) {
    const id = event.currentTarget.dataset.id;
    const child = this.data.children.find((item) => item.id === id);
    wx.showModal({
      title: "删除学生",
      content: `确定删除“${child ? child.name : "该学生"}”吗？相关记录会同步删除。`,
      confirmColor: "#c9503a",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteChild(id);
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  }
});
