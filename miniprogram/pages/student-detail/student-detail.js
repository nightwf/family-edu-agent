const api = require("../../utils/api");
const presentation = require("../../utils/presentation");
Page({
  data:{loading:true,error:"",childId:"",child:null,hero:presentation.deriveChildPresentation({}),stats:[]},
  onLoad(options){this.setData({childId:options.childId||wx.getStorageSync("familyEduSelectedChildId")||""});},
  onShow(){this.load();},
  async load(){this.setData({loading:true,error:""});try{const home=await api.mobileHome({child_id:this.data.childId});const rawChild=home.active_child;const child=rawChild?{...rawChild,subjectsText:(rawChild.subjects||[]).join("、")||"未设置",genderText:presentation.normalizedGender(rawChild.gender)==="female"?"女生":"男生",avatar:presentation.stateAsset("stable",rawChild.gender)}:null;const hero=presentation.deriveChildPresentation({child,childState:home.child_state,relationship:home.relationship,wrongQuestions:home.wrong_questions,mastery:home.mastery,reports:home.reports,homework:home.homework||[]});this.setData({child,hero,stats:[{label:"成长记录",value:(home.records||[]).length},{label:"阶段报告",value:(home.reports||[]).length},{label:"错题待处理",value:(home.wrong_questions&&home.wrong_questions.total)||0}],loading:false});}catch(error){this.setData({error:error.message,loading:false});}},
  goState(){wx.navigateTo({url:`/pages/child-state/child-state?childId=${this.data.childId}`});},
  goGrowth(){wx.switchTab({url:"/pages/growth/growth"});},
  goLearning(){wx.switchTab({url:"/pages/learning/learning"});}
});
