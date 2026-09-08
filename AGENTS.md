## AGENTS

### AGENTE 1 (Desarrollador Web )

**Rol del agente**: Desarrollador web experto con 12 años de experiencia 

**Objetivos** 
- Crear una App Web Tipo catalogo de productos para una empresa, en la app el cliente pueda seleccionar el producto y su variante e ir sumandolo al pedido, luego ese pedido se envia como pdf por whatsapp a un vendedor de la empresa

**Funcionalidad de la aplicacion**:
- Mostrar productos en un catalogo donde aparezca la foto y nombre del producto y el precio mas  barato de las variantes que tenga adentro.
- Al clickear el Producto se abre una ventana modal que muestra lkas variantes con el precio de cada una.
- cada producto tendra variates, ejemplo modelos (iphone 11, iphone 12, iphone 13, samsung a10, etc...)
- el cliente tiene el boton de sumar o restar cantidad al lado de cada variante del producto.
- una Vez que el cliente Termine de sumar cosas al pedido tiene un boton que dice "Terminar Pedido".
- Al tocar "Terminar Pedido" el cliente pasara a una seccion donde: 
        - Es obligatorio poner su nombre completo, telefono de contacto.
        - Vera el detalle del total de su pedido y podra modificar lo que desee.
        - aparece el total a pagar y la cantidad de articulos que pedira.
        - tiene un boton de "enviar pedido", al tocar aqui este pedido se Crea como pdf 
        - Una vez creado el pedido puede seleccionar el enviar por whatsapp a una vendedora o enviar por whatsapp al nro cargado en la app.
- dar aviso que primero se verificara existensia de stock de todos productos antes de confirmarle los datos asi hace el pago.
- El cliente solo necesita poner el nombre y telefono para enviar el pedido, no necesita iniciar sesion ni nada por el estilo. 
- Debe ser Totalmente responsivo pensado principalmente para dispositivos moviles (celular, tablet)
- El sistema consume productos desde un Manager, se enviara los datos por un json con todos los productos y sus variantes.
   

**Stack Tecnologico**:
- HTML5
- CSS3 (sin frameworks ni preprocesadores)
- JavaScript (vanilla- sin frameworks)

**Preferencias de estilos**:
- Que la app este en español
- colorPrincipal #3e863c (Este es el color de la marca, el color de los botones y destacados) 
- Uso de html5 y css3 nativo (sin tailwind ni frameworks)
- Usa  flexbox y grid para los layout
- Puedes usar  

**Preferencias de Codigo**:
- no añadas dependencias externas
- Html debe ser semantico
- no uses alert, confirm, prompt, todo el feedback debe ser visual en el dom 
- Comenta todo el codigo
- no uses innerhtml, todo el contenido debe ser insertador con appendchild, o previamente creando un elemento con document createElement 
- cuidado con olvidar prevenir el default de los eventos en submits o clicks 
- prioriza que el codigo sea escalable y mantenible 
- prioriza que el codigo sea sencillo de mantener 
- si el agente duda que revise las especificaciones del proyecto y si no que pregunte al usuario 

Estructura de Archivos: 
- Carpeta (assets)
    - carpeta (css)
    - carpeta (js)
    - carpeta (img)
- index.html
- AGENTS.md