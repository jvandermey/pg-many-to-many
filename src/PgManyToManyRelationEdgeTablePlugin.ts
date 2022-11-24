import { PgSource } from "@dataplan/pg";
import type {} from "graphile-config";
import { GraphQLObjectType } from "graphql";
import type {} from "postgraphile";

const version = require("../../package.json").version;

declare global {
  namespace GraphileBuild {
    interface ScopeObjectFieldsField {
      isPgManyToManyRelationEdgeTableField?: boolean;
      pgManyToManyJunctionTable?: PgSource<any, any, any, any>;
    }
  }
}

export const PgManyToManyRelationEdgeTablePlugin: GraphileConfig.Plugin = {
  name: "PgManyToManyRelationEdgeTablePlugin",
  description: `\
When a many-to-many relationship can be satisfied over multiple records (i.e.
the join is not unique, there can be multiple records in the junction table
that join the same left table and right table records), this plugin adds a
field to the edges where all of the join records can be traversed.`,
  version,

  schema: {
    hooks: {
      GraphQLObjectType_fields(fields, build, context) {
        const {
          extend,
          getTypeByName,
          graphql: { GraphQLNonNull, GraphQLList },
          inflection,
        } = build;
        const {
          scope: { isPgManyToManyEdgeType, pgManyToManyRelationship },
          fieldWithHooks,
          Self,
        } = context;
        if (!isPgManyToManyEdgeType || !pgManyToManyRelationship) {
          return fields;
        }

        const {
          leftTable,
          leftRelationName,
          rightTable,
          rightRelationName,
          junctionTable,
          allowsMultipleEdgesToNode,
        } = pgManyToManyRelationship;

        if (!allowsMultipleEdgesToNode) {
          return fields;
        }

        const JunctionTableType = build.getGraphQLTypeByPgCodec(
          junctionTable.codec,
          "output"
        ) as GraphQLObjectType | null;
        if (!JunctionTableType) {
          throw new Error(
            `Could not determine output type for ${junctionTable.name}`
          );
        }
        const JunctionTableConnectionType = getTypeByName(
          inflection.tableConnectionType(junctionTable.codec)
        ) as GraphQLObjectType | null;

        const relationDetails: GraphileBuild.PgRelationsPluginRelationDetails =
          {
            source: leftTable,
            codec: leftTable.codec,
            identifier: leftRelationName,
            relation: leftTable.getRelation(leftRelationName),
          };
        // TODO: these are almost certainly not the right names
        const connectionFieldName =
          build.inflection.manyRelationConnection(relationDetails);
        const listFieldName =
          build.inflection.manyRelationList(relationDetails);

        function makeFields(isConnection: boolean) {
          const fieldName = isConnection ? connectionFieldName : listFieldName;
          const Type = isConnection
            ? JunctionTableConnectionType
            : JunctionTableType;
          if (!Type) {
            return;
          }

          fields = extend(
            fields,
            {
              [fieldName]: fieldWithHooks(
                {
                  fieldName,
                  isPgFieldConnection: isConnection,
                  isPgFieldSimpleCollection: !isConnection,
                  isPgManyToManyRelationEdgeTableField: true,
                  pgManyToManyJunctionTable: junctionTable,
                },
                () => ({
                  description: `Reads and enables pagination through a set of \`${
                    JunctionTableType!.name
                  }\`.`,
                  type: isConnection
                    ? new GraphQLNonNull(JunctionTableConnectionType!)
                    : new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(JunctionTableType!))
                      ),
                  args: {},
                })
              ),
            },

            `Many-to-many relation edge table (${
              isConnection ? "connection" : "simple collection"
            }) on ${Self.name} type for ${rightRelationName}.`
          );
        }
        const behavior = build.pgGetBehavior([
          junctionTable.getRelation(rightRelationName).extensions,
          junctionTable.extensions,
        ]);
        if (
          build.behavior.matches(behavior, "connection", "connection -list")
        ) {
          makeFields(true);
        }
        if (build.behavior.matches(behavior, "list", "connection -list")) {
          makeFields(false);
        }
        return fields;
      },
    },
  },
};
