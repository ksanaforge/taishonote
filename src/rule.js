var actionhandler=null;
var codec=require("../../cbeta-address/codec");//shoudl move to node_modules
var Juan=require("../data/juan");
var jinjuan2vol=require("../data/jinjuan2vol");
var getFileByPointer=function(pointer){
	var i=indexOfSorted(Juan.juanstart,pointer);
	if (Juan.juanstart[i]>pointer)i--;
	var m=Juan.juanname[i].match(/(\d+)([AB]?)\.(\d+)/);
	var vol="0"+jinjuan2vol(m[1],parseInt(m[3]));
	vol=vol.substr(vol.length-2);
	var n = "0000"+m[1]; n=n.substr(n.length-4);
	var ab=m[2];//some sutra has A, B suffix
	var juan="00"+m[3];juan=juan.substr(juan.length-3);

	return "T"+vol+"/"+"T"+vol+"n"+n+ab+"_"+juan;
}
var getFileStart=function(){
	return codec.pack("01p0001a0000");
}
var indexOfSorted = function (array, obj) { 
  var low = 0,
  high = array.length-1;
  while (low < high) {
    var mid = (low + high) >> 1;
    array[mid] < obj ? low = mid + 1 : high = mid;
  }
  return low;
};
var isSurrogate=function(c){
	return c>=0xd800 &&c<=0xdfff;
}
var isChar=function(c){
	return (c>=0x3400 &&c<=0x9fff) || (c>0x20 && c<0x80);	
}
var isSkipChar=function(c){
	return (!(isChar(c)||isSurrogate(c)));
}
//advance n unicode characters, return new pointer
var advanceChar=function(text,adv){
	var i=0,ch=0;
	while (i<text.length && i<adv) {
		var c=text.charCodeAt(i);
		if (isChar(c)){
			ch++;
		} else if (isSurrogate(c)){
			ch++;
			i++;
		}
		i++;
	}
	return ch;
}

//advance taisho char , return number of unicode char.
var advanceTaishoChar=function(text,adv){
	var i=0;
	while (i<text.length && adv) {
		var c=text.charCodeAt(i);
		if (isChar(c)){
			adv--;
		} else if (isSurrogate(c)){
			adv--;
			i++;
		}
		i++;		
	}
	return i;
}

var textpos2pointer=function(textpos,text,lb,lb_pointer,filestart,bol){
	var at=indexOfSorted(lb,textpos);
	if (at>0) {
		if (textpos==lb[at] &&bol) return lb_pointer[at+1];//<p> at begining of lb

		var delta=textpos-lb[at-1];
		var linetext=text.substring(lb[at-1],lb[at]);
		return lb_pointer[at]+advanceChar(linetext,delta);
	} else {
		return filestart+advanceChar(text,textpos);
	}
}

var pointer2textpos=function(pointer,text,lb,lb_pointer,filestart){
	var at=indexOfSorted(lb_pointer,pointer);
	if (at>0) {
		at--;
		var ch=codec.charOf(pointer)-1;
		var linetext=text.substring(lb[at-1],lb[at]);
		var r=lb[at-1]+advanceTaishoChar(linetext,ch);
		return r;
	} else {
		return advanceTaishoChar(text,codec.charOf(pointer));
	}
}

var breakline=function(file,by){
	var breaker=file[by];
	var out="",offset=0, prev=0,pointers=file[by+"_pointer"]||[];
	var stock=file[by+"_pointer"];
	for (var i=0;i<breaker.length;i++){
		out+=file.content.substring(prev,breaker[i])+"\n";
		if (pointers !== stock ) {
			pointers.push(textpos2pointer(prev,file.content,file.lb,file.lb_pointer,file.pointer));
		}
		prev=breaker[i];
	}
	if (!stock) file[by+"_pointer"]=pointers;
	return {text:out,pointers};
}

var cursor2pointer=function(textpos,file,bol){
	var p=textpos2pointer(textpos,file.content,file.lb,file.lb_pointer,file.pointer,bol);
	return p;
}
var pointer2cursor=function(pointer,file){
	var c=pointer2textpos(pointer,file.content,file.lb,file.lb_pointer,file.pointer);
	return c;
}
var setActionHandler=function(_actionhandler){
	actionhandler=_actionhandler;
}

var decompressDelta=function(arr){
	for (var i=1;i<arr.length;i++) {
		arr[i]+=arr[i-1];
	}
}
//pointer of each lb
var buildlbpointer=function(file){
	var prev=file.pointer;

	/// file.lb[0] is offset of start of second line
	// file.lb_pointer has one more entry for first line , easier to render
	var pointers=[file.pointer];

	for (var i=1;i<file.lb.length;i++) {
		pointers.push(codec.nextLine(prev));
		prev=pointers[pointers.length-1];
	}
	return pointers;
}
var afterLoad=function(file){
	if (file.decompressed)return;
	if (typeof file.pointer=="string") {
		file.pointer=codec.pack(file.pointer);
	}

	if (file.lb) {
		decompressDelta(file.lb);
		file.lb_pointer=buildlbpointer(file);
	}
	if (file.p) decompressDelta(file.p);

	file.decompressed=true;
}

var packRange=function(from,to){
	if (from>to) {
		var t=to;
		to=from;
		from=t;
	}

	var delta=to-from;
	return delta*1073741824+from;
}
var unpackRange=function(rp){
	var delta=Math.floor((rp/1073741824)%(65536*128));//max 23 bits, 53(js real int)-30 bits
	var from=rp-delta*1073741824;
	return [from,delta+from];
}
var formatPointer=function(pointer){
	var r=unpackRange(pointer);
	var delta=r[1]-r[0];
	var t="@t"+codec.unpack(r[0])+(delta?("+"+delta.toString(16)):"");
	return t;//t.replace(/p0+/,"p").replace(/t0+/,"t");
}
var parsePointer=function(str){
	var m=str.match(/(\d+)p(\d+)([a-c])(\d{1,4})\+([0-9abcdef]*)/);
	if (!m) return null;
	var from=codec.pack(m[1]+"p"+m[2]+m[3]+m[4]);
	var to=from+parseInt(m[5],16);
	var file=getFileByPointer(from);
	var range=packRange(from,to);
	return {file,from,to,range};
}
module.exports={setActionHandler,breakline,getFileStart,
	nextiLne:codec.nextLine,formatPointer,
	afterLoad,
	cursor2pointer,
	pointer2cursor,
	parsePointer,
	packRange,
	unpackRange,
	textpos2pointer,pointer2textpos,
	isSkipChar
};