我要监控下面这个网站的offer数据，这个网站还提供了API，我已经申请到，网站有API说明。
API链接：
https://affiliates.mobipium.com/api/cpa/findmyoffers/?country=[country]&verticals=[vertical]&status=[status]&flows=[flows]&order_by=[order_by]&offers=[offers]&payout_above=[payout_above]&limit=100&pages=1&mwsd=18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9
这是一个mvas类的联盟网络网站，提供offer信息。我需要根据监控到的信息，寻找优质offer。
我要找到的信息主要有：
Last Conversion:最重要
Country:	
Carrier:
Type of Traffic:
Flow:
Payout:
Personal Daily CAP:
Global CAP:


我对监控的数据使用需求是，北京时间每天早上我手动调取数据查看，优先查看的是最近转化时间，实际上这个网站上一万多个offer，能展示有最近转化时间的只有一小部分，而这一小部分中还有转化速度较慢的offer，我想找到转化速度块，且转化数量多的offer。
目前我想要以五分钟为单位，进行一次API接口数据调取，记录在后台，可以在前端调取查阅，也可以展示出这个offer的时间的统计图。
另外一个功能就是对于选定的offer，如果发生最后转化时间变化幅度很大的情况，比如最后转化时间常为1分钟的offer，十分钟后仍然没有转化，就需要发邮件示警：这个offer可能出现了问题。